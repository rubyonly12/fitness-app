#!/usr/bin/env node
/**
 * 通过 GitHub REST API 推送提交。
 *
 * 背景：本机到 github.com 的 HTTPS CONNECT 隧道会被代理拒绝（502），
 * 而 git push 必须走 CONNECT，所以改用 GitHub REST API 推送。
 * API 调用统一交给 curl（已验证 curl 走代理可正常访问 api.github.com）。
 *
 * 流程：取 token → 建 tree → 建 commit → 更新 ref → 校验
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PROXY = 'http://127.0.0.1:3388';
const REPO = 'rubyonly12/fitness-app';
const API = 'https://api.github.com';
const BRANCH = 'main';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/* 用 curl 走代理调 GitHub API
   大文件（如 www/index.html 约 240KB）不能塞进命令行参数，
   因此把 JSON 请求体写到临时文件，用 --data-binary @file 传参。 */
function api(method, p, body) {
  const args = [
    '-sS', '-x', PROXY,
    '-X', method,
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28'
  ];
  let tmp = null;
  if (body !== undefined) {
    tmp = path.join(require('os').tmpdir(), 'gh-api-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push('-H', 'Content-Type: application/json');
    args.push('--data-binary', '@' + tmp);
  }
  args.push(API + p);
  let out;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (e) {} }
  }
  let j = null;
  try { j = JSON.parse(out); } catch (e) { throw new Error('响应非 JSON：' + out.slice(0, 300)); }
  if (j && j.message && j.status && j.status >= 400) {
    throw new Error(method + ' ' + p + ' -> HTTP ' + j.status + ' : ' + j.message);
  }
  return j;
}

(async () => {
  // 1. 取 token
  const credOut = execFileSync('git', [
    '-c', 'http.proxy=' + PROXY, '-c', 'https.proxy=' + PROXY, 'credential', 'fill'
  ], { cwd: ROOT, encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n', maxBuffer: 1024 * 1024 });
  const m = credOut.match(/^password=(.+)$/m);
  if (!m) throw new Error('未能从 Git Credential Manager 取到 GitHub 凭据');
  global.TOKEN = m[1].trim();
  console.log('✓ 已获取 GitHub 凭据');

  // 2. 远程 base
  const remote = api('GET', '/repos/' + REPO + '/commits/' + BRANCH);
  const baseSha = remote.sha;
  const baseTree = remote.commit.tree.sha;
  console.log('远程 ' + BRANCH + ' = ' + baseSha.slice(0, 12) + '  tree=' + baseTree.slice(0, 12));

  const hasBase = (() => {
    try { git(['cat-file', '-e', baseSha + '^{commit}']); return true; }
    catch (e) { return false; }
  })();

  let commitMsg = '', commitBody = '', baseTreeSha = baseTree;
  if (hasBase) {
    const range = baseSha + '..HEAD';
    const raw = git(['log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', range]);
    const items = raw.split('\x1e').map(s => s.replace(/^\s+/, '')).filter(Boolean)
      .map(s => { const [sha, subj, body] = s.split('\x1f'); return { sha, subj, body: body || '' }; });
    console.log('待推送提交数：' + items.length);
    baseTreeSha = git(['rev-parse', baseSha + '^{tree}']).trim();
    if (items.length === 1) {
      commitMsg = items[0].subj; commitBody = items[0].body;
    } else if (items.length > 1) {
      commitMsg = items.map(i => i.subj).join('\n');
      commitBody = items.map(i => 'commit ' + i.sha.slice(0, 12) + '\n\n' + i.subj + (i.body ? '\n\n' + i.body : '')).join('\n\n---\n\n');
    } else {
      console.log('本地与远程一致，无需推送');
      return;
    }
  } else {
    console.log('本地无远程 base 对象，退化为「整树单提交」模式');
    commitMsg = 'chore: sync local working tree';
    commitBody = '通过 GitHub API 推送本地工作树快照。';
  }

  // 3. 增量 tree：base_tree 继承远程全部文件，只把「本次改动的文件」写进去。
  //    这样无需上传历史遗留的 blob（本地旧 blob 远程不存在，会被 API 拒绝）。
  const diff = git(['diff', '--name-status', baseSha + '..HEAD']).trim();
  const changed = diff ? diff.split('\n').filter(Boolean).map(l => {
    const p = l.split('\t');
    return { status: p[0], path: p[p.length - 1] };
  }) : [];
  console.log('本次改动文件数：' + changed.length);

  // 远程已存在的 blob 集合（用于判断哪些需要上传）
  const remoteBlobs = new Set();
  const sub = api('GET', '/repos/' + REPO + '/git/trees/' + baseTreeSha + '?recursive=1');
  (sub.tree || []).forEach(t => { if (t.type === 'blob') remoteBlobs.add(t.sha); });

  const treeItems = [];
  let uploaded = 0;
  for (const ch of changed) {
    // 删除的文件
    if (ch.status === 'D') {
      treeItems.push({ path: ch.path, mode: '100644', type: 'blob', sha: '0000000000000000000000000000000000000000' });
      continue;
    }
    const entry = git(['ls-tree', 'HEAD', '--', ch.path]).trim();
    if (!entry) { console.log('  跳过（本地已不存在）：' + ch.path); continue; }
    const meta = entry.split(/\s+/);
    const mode = meta[0], type = meta[1], sha = meta[2];
    if (!remoteBlobs.has(sha)) {
      const content = git(['cat-file', 'blob', sha]);
      const up = api('POST', '/repos/' + REPO + '/git/blobs', {
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64'
      });
      if (up.sha !== sha) {
        throw new Error('blob 上传后 sha 不一致：期望 ' + sha + ' 实际 ' + up.sha + '（文件 ' + ch.path + '）');
      }
      uploaded++;
      console.log('  ↑ 上传 ' + ch.path + ' (' + ch.status + ')');
    } else {
      console.log('  · 复用 ' + ch.path + ' (' + ch.status + ')');
    }
    treeItems.push({ path: ch.path, mode: mode, type: type, sha: sha });
  }
  console.log('✓ 新上传 blob：' + uploaded + ' 个');

  const newTree = api('POST', '/repos/' + REPO + '/git/trees', { base_tree: baseTreeSha, tree: treeItems });
  console.log('✓ 新 tree = ' + newTree.sha.slice(0, 12));

  // 4. 建 commit
  const newCommit = api('POST', '/repos/' + REPO + '/git/commits', {
    message: commitMsg, tree: newTree.sha, parents: [baseSha]
  });
  console.log('✓ 新 commit = ' + newCommit.sha.slice(0, 12) + '  「' + commitMsg.split('\n')[0] + '」');

  // 5. 更新 ref
  const upd = api('PATCH', '/repos/' + REPO + '/git/refs/heads/' + BRANCH, { sha: newCommit.sha, force: false });
  console.log('✓ ' + BRANCH + ' → ' + upd.object.sha.slice(0, 12));

  // 6. 校验
  const after = api('GET', '/repos/' + REPO + '/commits/' + BRANCH);
  console.log('\n远程最新提交：' + after.sha.slice(0, 12) + ' | ' + after.commit.message.split('\n')[0]);
  console.log('变更文件：' + (after.files || []).map(f => f.filename).join(', '));
})().catch(e => {
  console.error('❌ 推送失败：' + e.message);
  process.exit(1);
});
