# verify_cloudbase.py
# 快速验证 CloudBase 数据是否写入

import requests

API_URL = "https://nightshift-d0gong2x832b1270e-1412242998.ap-shanghai.app.tcloudbase.com/api"

def check_collection(name, expected, where=None):
    try:
        resp = requests.post(API_URL, json={
            "path": "/api/count",
            "collection": name,
            "where": where or {}
        }, timeout=10)
        result = resp.json()
        count = result.get("count", 0)
        status = "✅" if count >= expected else "❌"
        print(f"  {status} {name:25s}: {count:5d} 条 (预期 {expected})")
        return count
    except Exception as e:
        print(f"  ❌ {name:25s}: 查询失败 - {e}")
        return 0

print("=" * 50)
print("CloudBase 数据验证")
print("=" * 50)

check_collection("users", 15)  # 至少要有数据
check_collection("dorm_students", 150)
check_collection("settings", 2)
check_collection("rooms", 20)
check_collection("room_states", 5000)
check_collection("room_logs", 500)
check_collection("room_messages", 40)
check_collection("room_members", 40)
check_collection("single_check_records", 3000)
check_collection("check_records", 300)
check_collection("check_sessions", 5)
check_collection("grade_mapping", 4)

print("=" * 50)
print("验证完成！")
