import Foundation
import Capacitor
import CloudKit

/// 将整份健身数据（volumex 的 JSON）作为单条 CKRecord 存到 CloudKit 私有数据库。
/// 私有数据库跟随设备当前登录的 Apple ID，无需额外账号注册。
@objc(CloudKitSyncPlugin)
public class CloudKitSyncPlugin: CAPPlugin {

    private let recordType = "VolumexData"
    private let recordName = "volumex_data"
    private let fieldJSON   = "json"

    /// save({ value: "<json 字符串>" }) -> 覆盖写同一条记录
    @objc func save(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else {
            call.reject("Missing 'value'")
            return
        }
        let field = fieldJSON
        let rtype = recordType
        let db = CKContainer.default().privateCloudDatabase
        let rid = CKRecord.ID(recordName: recordName)

        // 先尝试取已有记录，存在则覆盖、不存在则新建
        db.fetch(withRecordID: rid) { existing, _ in
            let record: CKRecord
            if let existing = existing {
                record = existing
            } else {
                record = CKRecord(recordType: rtype, recordID: rid)
            }
            record[field] = value as CKRecordValue
            db.save(record) { _, error in
                DispatchQueue.main.async {
                    if let error = error {
                        call.reject(error.localizedDescription)
                    } else {
                        call.resolve()
                    }
                }
            }
        }
    }

    /// fetch() -> { value: "<json 字符串>" }；记录不存在或出错时返回空字符串
    @objc func fetch(_ call: CAPPluginCall) {
        let field = fieldJSON
        let db = CKContainer.default().privateCloudDatabase
        let rid = CKRecord.ID(recordName: recordName)

        db.fetch(withRecordID: rid) { record, error in
            DispatchQueue.main.async {
                if let ckError = error as? CKError, ckError.code == .unknownItem {
                    // 记录还没创建属于正常情况，视为空
                    call.resolve(["value": ""])
                    return
                }
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }
                guard let record = record else {
                    call.resolve(["value": ""])
                    return
                }
                let v = record[field] as? String ?? ""
                call.resolve(["value": v])
            }
        }
    }

    /// isAvailable() -> { available: Bool }：用户是否已登录 iCloud 且容器可达
    @objc func isAvailable(_ call: CAPPluginCall) {
        CKContainer.default().accountStatus { status, _ in
            DispatchQueue.main.async {
                call.resolve(["available": status == .available])
            }
        }
    }
}
