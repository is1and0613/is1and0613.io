import json
import requests
import time
import os
from datetime import datetime

CLOUDBASE_API_URL = "https://nightshift-d0gong2x832b1270e-1412242998.ap-shanghai.app.tcloudbase.com/api"
DRY_RUN = False
SKIP_AUDIT_LOGS = True
REQUEST_DELAY = 0.5

TABLES = [
    'users', 'grade_mapping', 'dorm_students', 'settings', 'check_sessions',
    'rooms', 'room_states', 'room_logs', 'room_messages', 'room_members',
    'single_check_records', 'check_records', 'system_logs', 'login_logs'
]

id_maps = {
    'users': {},
    'rooms': {},
    'room_messages': {}
}

def transform_datetime(value):
    if not value:
        return None
    if isinstance(value, (int, float)):
        ts = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(ts).isoformat()
    if isinstance(value, str):
        for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d']:
            try:
                return datetime.strptime(value, fmt).isoformat()
            except:
                continue
        return value
    return str(value)

def load_table_data(table_name):
    filename = table_name + "_export.json"
    if not os.path.exists(filename):
        print("  [SKIP] " + filename + " not found")
        return []
    try:
        with open(filename, 'r', encoding='utf-8-sig') as f:
            raw = json.load(f)
        if isinstance(raw, list) and len(raw) > 0 and 'results' in raw[0]:
            records = raw[0].get('results', [])
            print("  [LOAD] " + filename + ": " + str(len(records)) + " records")
            return records
        else:
            print("  [WARN] " + filename + ": unknown format")
            return []
    except Exception as e:
        print("  [ERR]  " + filename + ": " + str(e))
        return []

def call_api(path, payload, retries=3):
    if DRY_RUN:
        print("  [DRY] " + path + ": " + json.dumps(payload, ensure_ascii=False)[:200])
        return {"code": 0, "data": {"id": "dry_run_id"}}
    for attempt in range(retries):
        try:
            resp = requests.post(
                CLOUDBASE_API_URL,
                json={"path": path, **payload},
                timeout=30,
                headers={"Content-Type": "application/json"}
            )
            result = resp.json()
            if result.get("code") == "FUNCTION_INVOCATION_FAILED" and attempt < retries - 1:
                wait = 2 ** attempt
                print("  [RETRY] timeout, waiting " + str(wait) + "s (" + str(attempt+1) + "/" + str(retries) + ")")
                time.sleep(wait)
                continue
            if result.get("code") != 0 and resp.status_code != 200:
                print("  [ERR] API: " + str(result))
            return result
        except requests.exceptions.Timeout:
            if attempt < retries - 1:
                wait = 2 ** attempt
                print("  [RETRY] request timeout, waiting " + str(wait) + "s")
                time.sleep(wait)
            else:
                print("  [ERR] Request Timeout")
                return {"code": 500, "error": "timeout"}
        except Exception as e:
            print("  [ERR] Request: " + str(e))
            return {"code": 500, "error": str(e)}
    return {"code": 500, "error": "max retries"}

def import_table(collection_name, records, transform_fn, use_batch=True):
    print("\n[IMPORT] " + collection_name + " (" + str(len(records)) + " records)")
    success = 0
    failed = 0

    if use_batch and len(records) > 0:
        batch_size = 5
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            transformed_batch = [transform_fn(r) for r in batch]

            result = call_api('/api/addBatch', {
                "collection": collection_name,
                "data": transformed_batch
            })

            if result.get("code") == 0:
                batch_results = result.get("results", [])
                for j, br in enumerate(batch_results):
                    if br.get("success"):
                        success += 1
                        old_id = batch[j].get('id')
                        new_id = br.get("_id")
                        if old_id is not None and new_id:
                            if collection_name not in id_maps:
                                id_maps[collection_name] = {}
                            id_maps[collection_name][old_id] = new_id
                    else:
                        failed += 1
                        print("    [FAIL] " + str(br.get("error", "unknown")) + " old_id=" + str(batch[j].get('id')))
            else:
                failed += len(batch)
                print("    [FAIL] batch: " + str(result))

            print("  [OK] batch " + str(i//batch_size + 1) + "/" + str((len(records)-1)//batch_size + 1) + ": +" + str(len(batch)) + " records")
            time.sleep(REQUEST_DELAY)
    else:
        for i, record in enumerate(records):
            transformed = transform_fn(record)
            result = call_api('/api/add', {
                "collection": collection_name,
                "data": transformed
            })
            if result.get("code") == 0:
                success += 1
                old_id = record.get('id')
                new_id = result.get("data", {}).get("id")
                if old_id is not None and new_id:
                    if collection_name not in id_maps:
                        id_maps[collection_name] = {}
                    id_maps[collection_name][old_id] = new_id
            else:
                failed += 1
            if (i + 1) % 20 == 0:
                print("  [OK] imported " + str(i+1) + "/" + str(len(records)) + " records")
                time.sleep(REQUEST_DELAY)

    print("  [SUM] " + collection_name + ": success=" + str(success) + " failed=" + str(failed))
    return success, failed

# ==================== transform functions ====================

# 【改动点】transform_users 加上 password_hash
def transform_users(record):
    return {
        "_old_id": record.get('id'),
        "username": record.get('username'),
        "password_hash": record.get('password_hash'),  # ← 新增
        "display_name": record.get('display_name'),
        "role": record.get('role', 'inspector'),
        "created_at": transform_datetime(record.get('created_at')),
        "last_login_at": transform_datetime(record.get('last_login_at')),
        "last_login_ip": record.get('last_login_ip'),
        "is_temp": bool(record.get('is_temp', 0)),
        "password_reset_required": True,
        "migrated_from": "d1"
    }

def transform_rooms(record):
    old_creator = record.get('creator_id')
    new_creator = id_maps.get('users', {}).get(old_creator, old_creator)
    return {
        "_old_id": record.get('id'),
        "code": record.get('code'),
        "creator_id": new_creator,
        "created_at": transform_datetime(record.get('created_at')),
        "expires_at": transform_datetime(record.get('expires_at')),
        "last_activity_at": transform_datetime(record.get('last_activity_at')),
        "status": record.get('status', 'active'),
        "dorm_building": record.get('dorm_building'),
        "migrated_from": "d1"
    }

def transform_room_members(record):
    old_room = record.get('room_id')
    old_user = record.get('user_id')
    new_room = id_maps.get('rooms', {}).get(old_room, old_room)
    new_user = id_maps.get('users', {}).get(old_user, old_user)
    old_msg_id = record.get('last_read_msg_id', 0)
    new_msg_id = id_maps.get('room_messages', {}).get(old_msg_id, old_msg_id) if old_msg_id else old_msg_id
    return {
        "_old_id": record.get('id'),
        "room_id": new_room,
        "user_id": new_user,
        "joined_at": transform_datetime(record.get('joined_at')),
        "role": record.get('role', 'member'),
        "last_read_msg_id": new_msg_id,
        "migrated_from": "d1"
    }

def transform_room_states(record):
    old_room = record.get('room_id')
    old_user = record.get('updated_by')
    new_room = id_maps.get('rooms', {}).get(old_room, old_room)
    new_user = id_maps.get('users', {}).get(old_user, old_user) if old_user else None
    return {
        "_old_id": record.get('id'),
        "room_id": new_room,
        "student_name": record.get('student_name'),
        "dorm_number": record.get('dorm_number'),
        "bed_number": record.get('bed_number'),
        "status": record.get('status', 'present'),
        "reason": record.get('reason'),
        "reason_detail": record.get('reason_detail'),
        "updated_by": new_user,
        "updated_by_name": record.get('updated_by_name'),
        "updated_at": transform_datetime(record.get('updated_at')),
        "migrated_from": "d1"
    }

def transform_room_logs(record):
    old_room = record.get('room_id')
    old_user = record.get('user_id')
    new_room = id_maps.get('rooms', {}).get(old_room, old_room)
    new_user = id_maps.get('users', {}).get(old_user, old_user)
    return {
        "_old_id": record.get('id'),
        "room_id": new_room,
        "user_id": new_user,
        "action_type": record.get('action_type'),
        "target_student": record.get('target_student'),
        "old_status": record.get('old_status'),
        "new_status": record.get('new_status'),
        "detail": record.get('detail'),
        "created_at": transform_datetime(record.get('created_at')),
        "migrated_from": "d1"
    }

def transform_room_messages(record):
    old_room = record.get('room_id')
    old_user = record.get('user_id')
    new_room = id_maps.get('rooms', {}).get(old_room, old_room)
    new_user = id_maps.get('users', {}).get(old_user, old_user)
    return {
        "_old_id": record.get('id'),
        "room_id": new_room,
        "user_id": new_user,
        "content": record.get('content'),
        "created_at": transform_datetime(record.get('created_at')),
        "migrated_from": "d1"
    }

def transform_check_sessions(record):
    return {
        "_id": record.get('id'),
        "user_id": record.get('user_id'),
        "floor": record.get('floor'),
        "created_at": transform_datetime(record.get('created_at')),
        "status": record.get('status', 'active'),
        "last_sync": transform_datetime(record.get('last_sync')),
        "migrated_from": "d1"
    }

def transform_check_records(record):
    return {
        "_old_id": record.get('session_id'),
        "session_id": record.get('session_id'),
        "student_name": record.get('student_name'),
        "status": record.get('status'),
        "reason": record.get('reason'),
        "updated_by": record.get('updated_by'),
        "updated_at": transform_datetime(record.get('updated_at')),
        "migrated_from": "d1"
    }

def transform_single_check_records(record):
    old_user = record.get('user_id')
    new_user = id_maps.get('users', {}).get(old_user, old_user)
    return {
        "_old_id": record.get('id'),
        "user_id": new_user,
        "check_date": record.get('check_date'),
        "student_id": record.get('student_id'),
        "student_name": record.get('student_name'),
        "dorm_number": record.get('dorm_number'),
        "bed_number": record.get('bed_number'),
        "grade": record.get('grade'),
        "class_name": record.get('class_name'),
        "status": record.get('status', 'in'),
        "reason": record.get('reason'),
        "updated_at": transform_datetime(record.get('updated_at')),
        "migrated_from": "d1"
    }

def transform_dorm_students(record):
    return {
        "_old_id": record.get('id'),
        "dorm_name": record.get('dorm_name'),
        "floor": record.get('floor'),
        "class_name": record.get('class_name'),
        "student_name": record.get('student_name'),
        "bed": record.get('bed'),
        "year_code": record.get('year_code'),
        "grade_name": record.get('grade_name'),
        "status": record.get('status', '在校'),
        "created_at": transform_datetime(record.get('created_at')),
        "updated_at": transform_datetime(record.get('updated_at')),
        "migrated_from": "d1"
    }

def transform_grade_mapping(record):
    return {
        "_id": record.get('year_code'),
        "year_code": record.get('year_code'),
        "grade_name": record.get('grade_name'),
        "display_order": record.get('display_order'),
        "migrated_from": "d1"
    }

def transform_settings(record):
    return {
        "_id": record.get('key'),
        "key": record.get('key'),
        "value": record.get('value'),
        "updated_at": transform_datetime(record.get('updated_at')),
        "migrated_from": "d1"
    }

def transform_system_logs(record):
    old_user = record.get('user_id')
    new_user = id_maps.get('users', {}).get(old_user, old_user) if old_user else None
    return {
        "_old_id": record.get('id'),
        "user_id": new_user,
        "username": record.get('username'),
        "role": record.get('role'),
        "action": record.get('action'),
        "target_type": record.get('target_type'),
        "target_id": record.get('target_id'),
        "detail": record.get('detail'),
        "ip": record.get('ip'),
        "user_agent": record.get('user_agent'),
        "created_at": transform_datetime(record.get('created_at')),
        "migrated_from": "d1"
    }

def transform_login_logs(record):
    old_user = record.get('user_id')
    new_user = id_maps.get('users', {}).get(old_user, old_user) if old_user else None
    return {
        "_old_id": record.get('id'),
        "user_id": new_user,
        "username": record.get('username'),
        "role": record.get('role'),
        "login_at": transform_datetime(record.get('login_at')),
        "ip": record.get('ip'),
        "user_agent": record.get('user_agent'),
        "status": record.get('status'),
        "fail_reason": record.get('fail_reason'),
        "migrated_from": "d1"
    }

# ==================== main ====================

def main():
    print("=" * 60)
    print("NightShift D1 -> CloudBase Migration v3")
    print("=" * 60)
    print("API URL: " + CLOUDBASE_API_URL)
    print("Dry Run: " + str(DRY_RUN))
    print("Skip Audit Logs: " + str(SKIP_AUDIT_LOGS))
    print("=" * 60)

    stats = {}

    # Phase 1: no dependencies
    records = load_table_data('users')
    if records:
        s, f = import_table('users', records, transform_users, use_batch=True)
        stats['users'] = {'success': s, 'failed': f}
        print("  [MAP] users ID mapping: " + str(len(id_maps.get('users', {}))) + " records")

    records = load_table_data('grade_mapping')
    if records:
        s, f = import_table('grade_mapping', records, transform_grade_mapping, use_batch=False)
        stats['grade_mapping'] = {'success': s, 'failed': f}

    records = load_table_data('dorm_students')
    if records:
        s, f = import_table('dorm_students', records, transform_dorm_students, use_batch=True)
        stats['dorm_students'] = {'success': s, 'failed': f}

    records = load_table_data('settings')
    if records:
        s, f = import_table('settings', records, transform_settings, use_batch=False)
        stats['settings'] = {'success': s, 'failed': f}

    records = load_table_data('check_sessions')
    if records:
        s, f = import_table('check_sessions', records, transform_check_sessions, use_batch=False)
        stats['check_sessions'] = {'success': s, 'failed': f}

    # Phase 2: depends on users
    records = load_table_data('rooms')
    if records:
        s, f = import_table('rooms', records, transform_rooms, use_batch=True)
        stats['rooms'] = {'success': s, 'failed': f}
        print("  [MAP] rooms ID mapping: " + str(len(id_maps.get('rooms', {}))) + " records")

    # Phase 3: depends on rooms + users
    records = load_table_data('room_states')
    if records:
        s, f = import_table('room_states', records, transform_room_states, use_batch=True)
        stats['room_states'] = {'success': s, 'failed': f}

    records = load_table_data('room_logs')
    if records:
        s, f = import_table('room_logs', records, transform_room_logs, use_batch=True)
        stats['room_logs'] = {'success': s, 'failed': f}

    records = load_table_data('room_messages')
    if records:
        s, f = import_table('room_messages', records, transform_room_messages, use_batch=True)
        stats['room_messages'] = {'success': s, 'failed': f}
        print("  [MAP] room_messages ID mapping: " + str(len(id_maps.get('room_messages', {}))) + " records")

    records = load_table_data('room_members')
    if records:
        s, f = import_table('room_members', records, transform_room_members, use_batch=True)
        stats['room_members'] = {'success': s, 'failed': f}

    # Phase 4: depends on users + check_sessions
    records = load_table_data('single_check_records')
    if records:
        s, f = import_table('single_check_records', records, transform_single_check_records, use_batch=True)
        stats['single_check_records'] = {'success': s, 'failed': f}

    records = load_table_data('check_records')
    if records:
        s, f = import_table('check_records', records, transform_check_records, use_batch=True)
        stats['check_records'] = {'success': s, 'failed': f}

    # Phase 5: audit logs (optional)
    if not SKIP_AUDIT_LOGS:
        records = load_table_data('system_logs')
        if records:
            s, f = import_table('system_logs', records, transform_system_logs, use_batch=True)
            stats['system_logs'] = {'success': s, 'failed': f}
        records = load_table_data('login_logs')
        if records:
            s, f = import_table('login_logs', records, transform_login_logs, use_batch=True)
            stats['login_logs'] = {'success': s, 'failed': f}
    else:
        print("\n[SKIP] Audit logs (system_logs, login_logs)")

    # Summary
    print("\n" + "=" * 60)
    print("Migration Summary")
    print("=" * 60)
    total_success = 0
    total_failed = 0
    for table, s in stats.items():
        print(table + ": success=" + str(s['success']) + " failed=" + str(s['failed']))
        total_success += s['success']
        total_failed += s['failed']
    print("-" * 60)
    print("TOTAL: success=" + str(total_success) + " failed=" + str(total_failed))
    print("=" * 60)

    with open('id_mapping.json', 'w', encoding='utf-8') as f:
        json.dump(id_maps, f, ensure_ascii=False, indent=2)
    print("\n[ID MAP] Saved to id_mapping.json")

    print("\n[DONE] Migration complete!")
    if DRY_RUN:
        print("[WARN] DRY_RUN mode, no data written.")

if __name__ == "__main__":
    main()