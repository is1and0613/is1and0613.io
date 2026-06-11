import json
import requests
import time
import os
from datetime import datetime

API_URL = "https://nightshift-d0gong2x832b1270e-1412242998.ap-shanghai.app.tcloudbase.com/api"
DRY_RUN = False
SKIP_AUDIT_LOGS = True
DELAY = 0.5

id_maps = {"users": {}, "rooms": {}, "room_messages": {}}

def dt(value):
    if not value: return None
    if isinstance(value, (int, float)):
        ts = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(ts).isoformat()
    if isinstance(value, str):
        for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"]:
            try: return datetime.strptime(value, fmt).isoformat()
            except: pass
        return value
    return str(value)

def load(name):
    f = name + "_export.json"
    if not os.path.exists(f): return []
    with open(f, "r", encoding="utf-8-sig") as fh:
        raw = json.load(fh)
    return raw[0].get("results", []) if isinstance(raw, list) and raw and "results" in raw[0] else []

def api(path, payload, retries=3):
    if DRY_RUN:
        print("  [DRY] " + path)
        return {"code": 0}
    for i in range(retries):
        try:
            r = requests.post(API_URL, json={"path": path, **payload}, timeout=30, headers={"Content-Type": "application/json"})
            res = r.json()
            if res.get("code") == "FUNCTION_INVOCATION_FAILED" and i < retries - 1:
                time.sleep(2 ** i)
                continue
            return res
        except:
            if i < retries - 1: time.sleep(2 ** i)
            else: return {"code": 500}
    return {"code": 500}

def import_table(coll, records, tf, batch=True):
    print("Importing " + coll + " (" + str(len(records)) + " records)")
    ok = 0
    fail = 0
    if not batch or not records:
        for rec in records:
            res = api("/api/add", {"collection": coll, "data": tf(rec)})
            ok += 1 if res.get("code") == 0 else 0
            fail += 0 if res.get("code") == 0 else 1
        return ok, fail
    bs = 5
    for i in range(0, len(records), bs):
        batch = records[i:i+bs]
        data = [tf(r) for r in batch]
        res = api("/api/addBatch", {"collection": coll, "data": data})
        if res.get("code") == 0:
            for j, br in enumerate(res.get("results", [])):
                if br.get("success"):
                    ok += 1
                    oid = batch[j].get("id")
                    nid = br.get("_id")
                    if oid is not None and nid:
                        id_maps.setdefault(coll, {})[oid] = nid
                else:
                    fail += 1
        else:
            fail += len(batch)
            print("  Batch failed: " + str(res))
        print("  Batch " + str(i//bs + 1) + "/" + str((len(records)-1)//bs + 1) + " done")
        time.sleep(DELAY)
    print("  " + coll + ": ok=" + str(ok) + " fail=" + str(fail))
    return ok, fail

# transforms
def tf_users(r): return {"_old_id": r.get("id"), "username": r.get("username"), "display_name": r.get("display_name"), "role": r.get("role", "inspector"), "created_at": dt(r.get("created_at")), "last_login_at": dt(r.get("last_login_at")), "is_temp": bool(r.get("is_temp", 0)), "password_reset_required": True, "migrated_from": "d1"}
def tf_grade(r): return {"_id": r.get("year_code"), "year_code": r.get("year_code"), "grade_name": r.get("grade_name"), "display_order": r.get("display_order"), "migrated_from": "d1"}
def tf_dorm(r): return {"_old_id": r.get("id"), "dorm_name": r.get("dorm_name"), "floor": r.get("floor"), "class_name": r.get("class_name"), "student_name": r.get("student_name"), "bed": r.get("bed"), "year_code": r.get("year_code"), "grade_name": r.get("grade_name"), "status": r.get("status", "在校"), "created_at": dt(r.get("created_at")), "updated_at": dt(r.get("updated_at")), "migrated_from": "d1"}
def tf_settings(r): return {"_id": r.get("key"), "key": r.get("key"), "value": r.get("value"), "updated_at": dt(r.get("updated_at")), "migrated_from": "d1"}
def tf_check_sess(r): return {"_id": r.get("id"), "user_id": r.get("user_id"), "floor": r.get("floor"), "created_at": dt(r.get("created_at")), "status": r.get("status", "active"), "last_sync": dt(r.get("last_sync")), "migrated_from": "d1"}
def tf_rooms(r): return {"_old_id": r.get("id"), "code": r.get("code"), "creator_id": id_maps.get("users", {}).get(r.get("creator_id"), r.get("creator_id")), "created_at": dt(r.get("created_at")), "expires_at": dt(r.get("expires_at")), "last_activity_at": dt(r.get("last_activity_at")), "status": r.get("status", "active"), "dorm_building": r.get("dorm_building"), "migrated_from": "d1"}
def tf_room_states(r): return {"_old_id": r.get("id"), "room_id": id_maps.get("rooms", {}).get(r.get("room_id"), r.get("room_id")), "student_name": r.get("student_name"), "dorm_number": r.get("dorm_number"), "bed_number": r.get("bed_number"), "status": r.get("status", "present"), "reason": r.get("reason"), "reason_detail": r.get("reason_detail"), "updated_by": id_maps.get("users", {}).get(r.get("updated_by")) if r.get("updated_by") else None, "updated_by_name": r.get("updated_by_name"), "updated_at": dt(r.get("updated_at")), "migrated_from": "d1"}
def tf_room_logs(r): return {"_old_id": r.get("id"), "room_id": id_maps.get("rooms", {}).get(r.get("room_id"), r.get("room_id")), "user_id": id_maps.get("users", {}).get(r.get("user_id"), r.get("user_id")), "action_type": r.get("action_type"), "target_student": r.get("target_student"), "old_status": r.get("old_status"), "new_status": r.get("new_status"), "detail": r.get("detail"), "created_at": dt(r.get("created_at")), "migrated_from": "d1"}
def tf_room_msg(r): return {"_old_id": r.get("id"), "room_id": id_maps.get("rooms", {}).get(r.get("room_id"), r.get("room_id")), "user_id": id_maps.get("users", {}).get(r.get("user_id"), r.get("user_id")), "content": r.get("content"), "created_at": dt(r.get("created_at")), "migrated_from": "d1"}
def tf_room_members(r): oid = r.get("last_read_msg_id", 0); return {"_old_id": r.get("id"), "room_id": id_maps.get("rooms", {}).get(r.get("room_id"), r.get("room_id")), "user_id": id_maps.get("users", {}).get(r.get("user_id"), r.get("user_id")), "joined_at": dt(r.get("joined_at")), "role": r.get("role", "member"), "last_read_msg_id": id_maps.get("room_messages", {}).get(oid, oid) if oid else oid, "migrated_from": "d1"}
def tf_single(r): return {"_old_id": r.get("id"), "user_id": id_maps.get("users", {}).get(r.get("user_id"), r.get("user_id")), "check_date": r.get("check_date"), "student_id": r.get("student_id"), "student_name": r.get("student_name"), "dorm_number": r.get("dorm_number"), "bed_number": r.get("bed_number"), "grade": r.get("grade"), "class_name": r.get("class_name"), "status": r.get("status", "in"), "reason": r.get("reason"), "updated_at": dt(r.get("updated_at")), "migrated_from": "d1"}
def tf_check_rec(r): return {"session_id": r.get("session_id"), "student_name": r.get("student_name"), "status": r.get("status"), "reason": r.get("reason"), "updated_by": r.get("updated_by"), "updated_at": dt(r.get("updated_at")), "migrated_from": "d1"}
def tf_syslog(r): return {"_old_id": r.get("id"), "user_id": id_maps.get("users", {}).get(r.get("user_id")) if r.get("user_id") else None, "username": r.get("username"), "role": r.get("role"), "action": r.get("action"), "target_type": r.get("target_type"), "target_id": r.get("target_id"), "detail": r.get("detail"), "user_agent": r.get("user_agent"), "created_at": dt(r.get("created_at")), "migrated_from": "d1"}
def tf_loginlog(r): return {"_old_id": r.get("id"), "user_id": id_maps.get("users", {}).get(r.get("user_id")) if r.get("user_id") else None, "username": r.get("username"), "role": r.get("role"), "login_at": dt(r.get("login_at")), "user_agent": r.get("user_agent"), "status": r.get("status"), "fail_reason": r.get("fail_reason"), "migrated_from": "d1"}

def main():
    print("=" * 50)
    print("NightShift Migration v3")
    print("=" * 50)
    stats = {}

    # phase 1: no deps
    d = load("users")
    if d: s, f = import_table("users", d, tf_users); stats["users"] = (s, f); print("users map: " + str(len(id_maps.get("users", {}))))
    d = load("grade_mapping")
    if d: s, f = import_table("grade_mapping", d, tf_grade, False); stats["grade_mapping"] = (s, f)
    d = load("dorm_students")
    if d: s, f = import_table("dorm_students", d, tf_dorm); stats["dorm_students"] = (s, f)
    d = load("settings")
    if d: s, f = import_table("settings", d, tf_settings, False); stats["settings"] = (s, f)
    d = load("check_sessions")
    if d: s, f = import_table("check_sessions", d, tf_check_sess, False); stats["check_sessions"] = (s, f)

    # phase 2: depends on users
    d = load("rooms")
    if d: s, f = import_table("rooms", d, tf_rooms); stats["rooms"] = (s, f); print("rooms map: " + str(len(id_maps.get("rooms", {}))))

    # phase 3: depends on rooms + users
    d = load("room_states")
    if d: s, f = import_table("room_states", d, tf_room_states); stats["room_states"] = (s, f)
    d = load("room_logs")
    if d: s, f = import_table("room_logs", d, tf_room_logs); stats["room_logs"] = (s, f)
    d = load("room_messages")
    if d: s, f = import_table("room_messages", d, tf_room_msg); stats["room_messages"] = (s, f); print("msg map: " + str(len(id_maps.get("room_messages", {}))))
    d = load("room_members")
    if d: s, f = import_table("room_members", d, tf_room_members); stats["room_members"] = (s, f)

    # phase 4: depends on users + check_sessions
    d = load("single_check_records")
    if d: s, f = import_table("single_check_records", d, tf_single); stats["single_check_records"] = (s, f)
    d = load("check_records")
    if d: s, f = import_table("check_records", d, tf_check_rec); stats["check_records"] = (s, f)

    # phase 5: audit logs
    if not SKIP_AUDIT_LOGS:
        d = load("system_logs")
        if d: s, f = import_table("system_logs", d, tf_syslog); stats["system_logs"] = (s, f)
        d = load("login_logs")
        if d: s, f = import_table("login_logs", d, tf_loginlog); stats["login_logs"] = (s, f)
    else:
        print("Skip audit logs")

    # summary
    print("=" * 50)
    total_ok = 0
    total_fail = 0
    for t, (s, f) in stats.items():
        print(t + ": ok=" + str(s) + " fail=" + str(f))
        total_ok += s
        total_fail += f
    print("TOTAL: ok=" + str(total_ok) + " fail=" + str(total_fail))
    print("=" * 50)

    with open("id_mapping.json", "w", encoding="utf-8") as fh:
        json.dump(id_maps, fh, ensure_ascii=False, indent=2)
    print("ID map saved to id_mapping.json")
    print("Done!")

if __name__ == "__main__":
    main()