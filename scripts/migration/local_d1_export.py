# local_d1_export.py
# Windows 修复版：直接调用 wrangler CLI 导出 D1 数据
# 运行方式: python local_d1_export.py

import subprocess
import json
import os

# 项目目录（修改为你的路径）
PROJECT_DIR = r"E:\上大学。。。\女工\NightShift"
os.chdir(PROJECT_DIR)

# 数据库名
DB_NAME = "nightshift-db"

# 14 张表
TABLES = [
    'users', 'rooms', 'room_members', 'room_states', 'room_logs', 
    'room_messages', 'check_sessions', 'check_records', 'single_check_records',
    'dorm_students', 'grade_mapping', 'settings', 'system_logs', 'login_logs'
]

export_data = {}

for table in TABLES:
    print(f"\n🚀 导出 {table}...")

    # Windows 必须用 shell=True 才能找到 npx
    cmd = f'npx wrangler d1 execute {DB_NAME} --command "SELECT * FROM {table}" --json'

    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', shell=True)

    stdout = result.stdout.strip()

    try:
        # 方案1: 直接解析 JSON
        rows = json.loads(stdout)
        export_data[table] = {
            "count": len(rows),
            "data": rows
        }
        print(f"  ✅ {len(rows)} 条")

    except json.JSONDecodeError:
        # 方案2: 从输出中提取 JSON 数组
        start = stdout.find('[')
        end = stdout.rfind(']')

        if start != -1 and end != -1 and end > start:
            try:
                rows = json.loads(stdout[start:end+1])
                export_data[table] = {
                    "count": len(rows),
                    "data": rows
                }
                print(f"  ✅ {len(rows)} 条 (提取)")
            except json.JSONDecodeError:
                print(f"  ❌ JSON 解析失败")
                print(f"     输出: {stdout[:300]}")
                export_data[table] = {"count": 0, "data": [], "error": "parse_failed", "raw": stdout[:500]}
        else:
            print(f"  ❌ 未找到 JSON 数组")
            print(f"     输出: {stdout[:300]}")
            export_data[table] = {"count": 0, "data": [], "error": "no_json", "raw": stdout[:500]}

    if result.stderr:
        print(f"  ⚠️  stderr: {result.stderr[:200]}")

# 保存为 JSON
output = {
    "exported_at": "2026-06-10T00:00:00Z",
    "database_name": DB_NAME,
    "tables": TABLES,
    "data": export_data
}

with open('d1_export.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print("\n" + "="*60)
print("📊 导出完成")
print("="*60)
total = sum(t['count'] for t in export_data.values())
print(f"总计: {total} 条记录")
print(f"文件: d1_export.json")
print("="*60)
