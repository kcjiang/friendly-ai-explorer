-- docker exec -i fae_postgres psql -U admin -d fae_app_pgdb < db/migration_v4_debug.sql

-- 预制命令表（ADB / 串口通用）
CREATE TABLE IF NOT EXISTS preset_commands (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(200) NOT NULL,
  command     TEXT NOT NULL,
  group_name  VARCHAR(100) DEFAULT '通用',
  device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('adb','serial')),
  is_public   BOOLEAN DEFAULT false,
  is_danger   BOOLEAN DEFAULT false,
  owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
-- is_public=true 且 owner_id=NULL → 公共命令（开发者管理）
-- is_public=false 且 owner_id=用户ID → 个人命令

-- 内置公共 ADB 命令
INSERT INTO preset_commands (name,command,group_name,device_type,is_public,is_danger) VALUES
  ('型号',          'getprop ro.product.model',                          '设备信息','adb',true,false),
  ('系统版本',      'getprop ro.build.version.release',                  '设备信息','adb',true,false),
  ('所有属性',      'getprop',                                           '设备信息','adb',true,false),
  ('屏幕分辨率',    'wm size',                                           '设备信息','adb',true,false),
  ('磁盘空间',      'df -h',                                             '设备信息','adb',true,false),
  ('内存信息',      'free -h',                                           '设备信息','adb',true,false),
  ('电池状态',      'dumpsys battery',                                   '设备信息','adb',true,false),
  ('网络接口',      'ip addr show',                                      '设备信息','adb',true,false),
  ('三方应用',      'pm list packages -3',                               '应用管理','adb',true,false),
  ('前台应用',      'dumpsys activity | grep -i resumed',               '应用管理','adb',true,false),
  ('清除日志',      'logcat -c && echo "日志已清除"',                    '应用管理','adb',true,false),
  ('重启',          'reboot',                                            '控制',    'adb',true,true),
  ('重启 Recovery', 'reboot recovery',                                   '控制',    'adb',true,true),
  ('重启 Bootloader','reboot bootloader',                                '控制',    'adb',true,true);

-- 内置公共串口命令
INSERT INTO preset_commands (name,command,group_name,device_type,is_public,is_danger) VALUES
  ('回车',          E'\r\n',        '通用',         'serial',true,false),
  ('帮助',          E'help\r\n',    '通用',         'serial',true,false),
  ('查看版本',      E'version\r\n', '通用',         'serial',true,false),
  ('dmesg',         E'dmesg\r\n',   'Android 串口', 'serial',true,false),
  ('查看进程',      E'ps\r\n',      'Android 串口', 'serial',true,false),
  ('存储信息',      E'df -h\r\n',   'Android 串口', 'serial',true,false),
  ('停止 Android',  E'stop\r\n',    'Android 串口', 'serial',true,true),
  ('启动 Android',  E'start\r\n',   'Android 串口', 'serial',true,false),
  ('重启设备',      E'reboot\r\n',  '控制',         'serial',true,true);

-- 上传的日志文件表
CREATE TABLE IF NOT EXISTS uploaded_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('adb','serial')),
  filename    VARCHAR(500) NOT NULL,
  file_path   VARCHAR(500) NOT NULL,
  file_size   BIGINT DEFAULT 0,
  line_count  INT DEFAULT 0,
  description VARCHAR(500),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
