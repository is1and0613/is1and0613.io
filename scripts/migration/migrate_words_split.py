import requests

API_URL = "https://nightshift-d0gong2x832b1270e-1412242998.ap-shanghai.app.tcloudbase.com/api"
WORDS_FILE = "sensitive-words/merged.txt"
CHUNK_LINES = 1000

def upload():
    with open(WORDS_FILE, "r", encoding="utf-8") as f:
        all_lines = f.read().splitlines()
    total = len(all_lines)
    chunks = (total - 1) // CHUNK_LINES + 1
    print("Loaded " + str(total) + " lines, " + str(chunks) + " chunks")

    for i in range(chunks):
        start = i * CHUNK_LINES
        end = min((i + 1) * CHUNK_LINES, total)
        chunk = "\n".join(all_lines[start:end])

        key = "sensitive_words_" + str(i)
        print("Uploading chunk " + str(i+1) + "/" + str(chunks) + " (" + str(end-start) + " lines, " + str(len(chunk)) + " chars)")

        resp = requests.post(API_URL, json={
            "path": "/api/add",
            "collection": "settings",
            "data": {
                "_id": key,
                "key": key,
                "value": chunk,
                "updated_at": "2026-06-11T01:00:00"
            }
        }, timeout=30, headers={"Content-Type": "application/json"})

        result = resp.json()
        if result.get("code") == 0:
            print("  OK")
        else:
            print("  FAILED: " + str(result))
            break

        # 每块间隔 1 秒，避免并发限制
        import time
        time.sleep(1)

    # 写入总块数记录
    print("Writing chunk count...")
    resp = requests.post(API_URL, json={
        "path": "/api/add",
        "collection": "settings",
        "data": {
            "_id": "sensitive_words_chunks",
            "key": "sensitive_words_chunks",
            "value": str(chunks),
            "updated_at": "2026-06-11T01:00:00"
        }
    }, timeout=30)

    if resp.json().get("code") == 0:
        print("Done! Total chunks: " + str(chunks))
    else:
        print("Count record failed")

if __name__ == "__main__":
    upload()