require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'CloudkitSync'
  s.version      = package['version']
  s.summary      = 'CloudKit private database sync for VolumeX fitness'
  s.license      = 'MIT'
  s.homepage     = 'https://example.com'
  s.author       = { 'VolumeX' => 'dev@example.com' }
  s.source       = { :path => '.' }
  s.source_files = 'Plugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
