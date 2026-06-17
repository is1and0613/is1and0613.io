#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NightShift 云端清理脚本 —— 只清云端，不动本地
================================================
功能：
1. Cloudflare Pages：删除所有历史部署，仅保留当前线上版本
2. Git 仓库：重写历史抹除敏感文件，但本地工作区文件保留不动

⚠️ 原则：本地文件一个不动，只确保敏感数据不留在云端。

用法：
    python niteshift_cloud_cleanup.py
"""

import os
import sys
import time
import subprocess
from pathlib import Path

# ========================= 用户配置区 =========================
CF_ACCOUNT_ID = ""          # Cloudflare Account ID
CF_API_TOKEN = ""           # Cloudflare API Token (Cloudflare Pages:Edit)
CF_PROJECT_NAME = "nightshift"

GIT_REPO_PATH = r"E:\上大学。。。\女工\NightShift"
# 要从 Git 历史中抹除的文件模式（本地文件会保留，仅从历史中移除）
GIT_ERASE_PATTERNS = [
    "*.json",
    "*.csv",
    "sensitive-words",
    "backup",
    "dump",
    "export",
]

LOCAL_SCAN_PATH = r"E:\上大学。。。\女工\NightShift"
# =============================================================


class Colors:
    RED = "[91m"
    GREEN = "[92m"
    YELLOW = "[93m"
    BLUE = "[94m"
    CYAN = "[96m"
    BOLD = "[1m"
    END = "[0m"


def print_banner():
    print(f"""{Colors.CYAN}{Colors.BOLD}
╔════════════════════════════════════════════════════════════════╗
║              NightShift 云端清理 —— 本地文件不动               ║
║                                                                ║
║  原则：只清理 Cloudflare 部署历史和 Git 远程历史，              ║
║        本地文件一个不动。                                       ║
╚════════════════════════════════════════════════════════════════╝{Colors.END}
""")


def fatal(msg):
    print(f"{Colors.RED}{Colors.BOLD}❌ FATAL: {msg}{Colors.END}")
    sys.exit(1)


def ask(msg, default=False):
    hint = "[Y/n]" if default else "[y/N]"
    ans = input(f"{Colors.YELLOW}⚠️  {msg} {hint}: {Colors.END}").strip().lower()
    if not ans:
        return default
    return ans in ("y", "yes", "是", "确认")


def check_requests():
    try:
        import requests
        return requests
    except ImportError:
        print(f"{Colors.YELLOW}🔧 安装 requests...{Colors.END}")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
        import requests
        return requests


# =====================================================================
# 模块 1：Cloudflare Pages —— 删除所有历史部署
# =====================================================================

def cf_get_deployments(requests_lib, account_id, token, project_name):
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects/{project_name}/deployments"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    all_deps = []
    page = 1
    while True:
        resp = requests_lib.get(url, headers=headers, params={"page": page, "per_page": 25})
        if resp.status_code != 200:
            print(f"{Colors.RED}   API 错误: {resp.status_code} - {resp.text[:200]}{Colors.END}")
            return None
        data = resp.json()
        if not data.get("success"):
            return None
        batch = data.get("result", [])
        if not batch:
            break
        all_deps.extend(batch)
        page += 1
    all_deps.sort(key=lambda x: x.get("created_on", ""), reverse=True)
    return all_deps


def cf_delete_deployment(requests_lib, account_id, token, project_name, dep_id):
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects/{project_name}/deployments/{dep_id}"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests_lib.delete(url, headers=headers)
    return resp.status_code == 200


def run_cf_cleanup():
    print(f"
{Colors.BOLD}{Colors.BLUE}【模块 1】Cloudflare Pages 部署历史清理{Colors.END}")
    print(f"{Colors.CYAN}策略：删除所有历史部署，仅保留当前线上生产版本。{Colors.END}")

    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        fatal("请在脚本顶部填写 CF_ACCOUNT_ID 和 CF_API_TOKEN")

    requests_lib = check_requests()
    print(f"🔍 获取项目 [{CF_PROJECT_NAME}] 部署列表...")
    deps = cf_get_deployments(requests_lib, CF_ACCOUNT_ID, CF_API_TOKEN, CF_PROJECT_NAME)
    if deps is None:
        return False

    total = len(deps)
    if total == 0:
        print(f"{Colors.GREEN}✅ 该项目没有任何部署历史。{Colors.END}")
        return True

    production_id = deps[0]["id"]
    to_delete = deps[1:]

    print(f"📦 共 {total} 个部署")
    print(f"   {Colors.GREEN}保留: 当前线上版 {production_id[:16]}...{Colors.END}")
    print(f"   {Colors.RED}删除: {len(to_delete)} 个历史部署{Colors.END}")

    if to_delete:
        print(f"
{Colors.YELLOW}历史部署列表（将被删除）:{Colors.END}")
        for i, dep in enumerate(to_delete, 1):
            dep_id = dep["id"][:20]
            created = dep.get("created_on", "unknown")[:19]
            branch = dep.get("deployment_trigger", {}).get("metadata", {}).get("branch", "unknown")
            print(f"   {i}. {dep_id} | {created} | {branch}")

    if not ask(f"确认删除上述 {len(to_delete)} 个 Cloudflare Pages 历史部署？"):
        print(f"{Colors.YELLOW}⏹️ 已跳过 Cloudflare 清理。{Colors.END}")
        return False

    deleted = 0
    failed = 0
    for dep in to_delete:
        dep_id = dep["id"]
        if cf_delete_deployment(requests_lib, CF_ACCOUNT_ID, CF_API_TOKEN, CF_PROJECT_NAME, dep_id):
            print(f"   {Colors.GREEN}✅ 已删除 {dep_id[:16]}...{Colors.END}")
            deleted += 1
        else:
            print(f"   {Colors.RED}❌ 删除失败 {dep_id[:16]}...{Colors.END}")
            failed += 1
        time.sleep(0.5)

    print(f"
{Colors.GREEN}🏁 Cloudflare 清理完成：删除 {deleted} 个，失败 {failed} 个。{Colors.END}")
    print(f"{Colors.CYAN}💡 当前线上版本 {production_id[:16]}... 仍然可用。{Colors.END}")
    return True


# =====================================================================
# 模块 2：Git 仓库 —— 重写历史，但本地文件保留
# =====================================================================

def run_git_cleanup():
    print(f"
{Colors.BOLD}{Colors.BLUE}【模块 2】Git 仓库历史清理（本地文件保留）{Colors.END}")
    print(f"{Colors.CYAN}策略：从历史中抹除敏感文件，但本地工作区文件不动。{Colors.END}")

    repo_path = Path(GIT_REPO_PATH)
    if not repo_path.exists():
        fatal(f"仓库路径不存在: {GIT_REPO_PATH}")

    git_dir = repo_path / ".git"
    if not git_dir.exists():
        fatal(f"该目录不是 Git 仓库: {GIT_REPO_PATH}")

    os.chdir(repo_path)

    # 检查工作区是否干净
    result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, check=False)
    if result.stdout.strip():
        print(f"{Colors.YELLOW}⚠️  工作区有未提交修改：{Colors.END}")
        print(result.stdout[:500])
        if not ask("是否先自动提交所有修改再继续？"):
            print(f"{Colors.YELLOW}请先手动处理工作区后再运行。{Colors.END}")
            return False
        subprocess.run(["git", "add", "-A"], check=False)
        subprocess.run(["git", "commit", "-m", "cleanup: auto-commit before history rewrite"], check=False)

    # 检查 git-filter-repo
    has_tool = False
    try:
        r = subprocess.run(["git", "filter-repo", "--help"], capture_output=True, text=True, check=False)
        has_tool = r.returncode == 0 or "usage" in r.stderr.lower()
    except FileNotFoundError:
        pass

    if not has_tool:
        print(f"{Colors.YELLOW}🔧 未检测到 git-filter-repo，正在安装...{Colors.END}")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "git-filter-repo", "-q"])
            import site
            user_base = site.getusersitepackages() if hasattr(site, 'getusersitepackages') else site.USER_SITE
            scripts = os.path.join(os.path.dirname(user_base), "Scripts") if "site-packages" in user_base else os.path.join(os.path.expanduser("~"), ".local", "bin")
            if os.path.exists(scripts):
                os.environ["PATH"] = scripts + os.pathsep + os.environ.get("PATH", "")
            r = subprocess.run(["git", "filter-repo", "--help"], capture_output=True, text=True, check=False)
            has_tool = r.returncode == 0 or "usage" in r.stderr.lower()
        except Exception as e:
            print(f"{Colors.RED}安装失败: {e}{Colors.END}")

    if not has_tool:
        print(f"{Colors.RED}❌ 无法使用 git-filter-repo。{Colors.END}")
        print(f"{Colors.CYAN}手动替代方案：{Colors.END}")
        print(f"   1. 备份当前仓库")
        print(f"   2. 删除 .git 目录：rd /s /q .git")
        print(f"   3. 重新初始化：git init")
        print(f"   4. 添加远程：git remote add origin <你的仓库URL>")
        print(f"   5. 提交当前代码：git add -A && git commit -m 'clean commit'")
        print(f"   6. 强制推送：git push --force origin main")
        print(f"{Colors.YELLOW}   注意：此方案会丢失所有历史 commit，但本地文件完全保留。{Colors.END}")
        return False

    # 扫描历史中的敏感文件
    print(f"🔍 扫描 Git 历史中的敏感文件...")
    result = subprocess.run(["git", "log", "--all", "--pretty=format:", "--name-only"],
                            capture_output=True, text=True, check=False)
    all_files = {f.strip() for f in result.stdout.split("
") if f.strip()}

    sensitive_files = set()
    for pattern in GIT_ERASE_PATTERNS:
        if pattern.startswith("*"):
            ext = pattern[1:]
            for f in all_files:
                if f.endswith(ext):
                    sensitive_files.add(f)
        else:
            for f in all_files:
                if pattern in f or f.endswith(pattern):
                    sensitive_files.add(f)

    if not sensitive_files:
        print(f"{Colors.GREEN}✅ Git 历史中未发现敏感文件，无需重写。{Colors.END}")
    else:
        print(f"{Colors.RED}⚠️  发现 {len(sensitive_files)} 个敏感文件存在于 Git 历史中:{Colors.END}")
        for f in sorted(sensitive_files)[:20]:
            print(f"   - {f}")
        if len(sensitive_files) > 20:
            print(f"   ... 还有 {len(sensitive_files)-20} 个")

        if not ask("确认使用 git-filter-repo 抹除上述文件的历史痕迹？"):
            print(f"{Colors.YELLOW}⏹️ 已跳过 Git 清理。{Colors.END}")
            return False

        # 关键步骤：先备份本地匹配的文件，因为 filter-repo 会从工作区删除它们
        backup_dir = Path.home() / f"niteshift_local_backup_{int(time.time())}"
        backup_dir.mkdir(exist_ok=True)
        backed_up = []

        print(f"
{Colors.CYAN}💾 正在备份本地匹配的文件到: {backup_dir}{Colors.END}")
        for rel_path in sorted(sensitive_files):
            abs_path = repo_path / rel_path
            if abs_path.exists() and abs_path.is_file():
                backup_path = backup_dir / Path(rel_path).name
                import shutil
                shutil.copy2(abs_path, backup_path)
                backed_up.append((rel_path, str(backup_path)))
                print(f"   {Colors.GREEN}✅ 已备份: {rel_path} → {backup_path}{Colors.END}")

        if backed_up:
            print(f"
{Colors.YELLOW}⚠️  以下文件将在历史重写后从工作区移除，但已备份到上述目录：{Colors.END}")
            for orig, _ in backed_up:
                print(f"   - {orig}")

        # 创建备份分支
        backup_branch = f"pre-cleanup-{int(time.time())}"
        subprocess.run(["git", "branch", backup_branch], capture_output=True, check=False)
        print(f"
{Colors.GREEN}✅ 已创建备份分支: {backup_branch}{Colors.END}")

        # 执行 git-filter-repo
        cmd = ["git", "filter-repo", "--force"]
        for pattern in GIT_ERASE_PATTERNS:
            if pattern.startswith("*"):
                cmd.extend(["--path-glob", pattern])
            else:
                cmd.extend(["--path", pattern])
        cmd.append("--invert-paths")

        print(f"{Colors.YELLOW}🔧 执行 git-filter-repo...{Colors.END}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            print(f"{Colors.RED}❌ git-filter-repo 失败:{Colors.END}")
            print(result.stderr[:500])
            return False
        print(f"{Colors.GREEN}✅ Git 历史重写完成。{Colors.END}")

        # 恢复备份的文件到工作区
        if backed_up:
            print(f"
{Colors.CYAN}🔄 正在恢复本地文件...{Colors.END}")
            for orig_rel, backup_path in backed_up:
                orig_abs = repo_path / orig_rel
                orig_abs.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup_path, orig_abs)
                print(f"   {Colors.GREEN}✅ 已恢复: {orig_rel}{Colors.END}")

            # 将这些文件加入 .gitignore
            gitignore = repo_path / ".gitignore"
            existing = set()
            if gitignore.exists():
                existing = {line.strip() for line in gitignore.read_text(encoding="utf-8").splitlines()}

            new_entries = []
            for pattern in GIT_ERASE_PATTERNS:
                if pattern not in existing and f"/{pattern}" not in existing:
                    new_entries.append(pattern)

            if new_entries:
                with open(gitignore, "a", encoding="utf-8") as f:
                    if gitignore.exists() and not gitignore.read_text(encoding="utf-8").endswith("
"):
                        f.write("
")
                    f.write("
# NightShift cleanup - sensitive files
")
                    for entry in new_entries:
                        f.write(f"{entry}
")
                print(f"{Colors.GREEN}✅ 已更新 .gitignore，防止敏感文件再次进入版本控制。{Colors.END}")

            # 提交 .gitignore 更改
            subprocess.run(["git", "add", ".gitignore"], check=False)
            subprocess.run(["git", "commit", "-m", "cleanup: add sensitive files to .gitignore"], check=False)
            print(f"{Colors.GREEN}✅ 已提交 .gitignore 更新。{Colors.END}")

    # 强制推送到远程
    print(f"
{Colors.BOLD}{Colors.RED}🚀 准备强制推送到远程仓库...{Colors.END}")
    print(f"{Colors.YELLOW}这将覆盖 GitHub 上的所有历史提交。{Colors.END}")

    if not ask("确认执行 git push --force？"):
        print(f"{Colors.YELLOW}⏹️ 已跳过推送。请稍后手动执行：{Colors.END}")
        print(f"   git push --force origin --all")
        print(f"   git push --force origin --tags")
        return True

    r1 = subprocess.run(["git", "push", "--force", "origin", "--all"], capture_output=True, text=True, check=False)
    if r1.returncode == 0:
        print(f"{Colors.GREEN}✅ 所有分支已强制推送。{Colors.END}")
    else:
        print(f"{Colors.YELLOW}⚠️  分支推送遇到问题：{r1.stderr[:200]}{Colors.END}")

    r2 = subprocess.run(["git", "push", "--force", "origin", "--tags"], capture_output=True, text=True, check=False)
    if r2.returncode == 0:
        print(f"{Colors.GREEN}✅ 所有标签已强制推送。{Colors.END}")
    else:
        print(f"{Colors.YELLOW}⚠️  标签推送遇到问题（可能没有标签）{Colors.END}")

    print(f"
{Colors.GREEN}🏁 Git 清理完成。{Colors.END}")
    print(f"{Colors.CYAN}💡 本地文件已保留并加入 .gitignore，不会再次进入版本控制。{Colors.END}")
    print(f"{Colors.CYAN}💡 请登录 GitHub 确认敏感文件已从历史提交中消失。{Colors.END}")
    return True


# =====================================================================
# 模块 3：本地扫描（只报告，不删除）
# =====================================================================

def run_local_scan():
    print(f"
{Colors.BOLD}{Colors.BLUE}【模块 3】本地敏感文件扫描（仅报告，不删除）{Colors.END}")

    scan_path = Path(LOCAL_SCAN_PATH)
    if not scan_path.exists():
        print(f"{Colors.RED}❌ 扫描路径不存在: {LOCAL_SCAN_PATH}{Colors.END}")
        return False

    print(f"🔍 扫描目录: {scan_path}")

    suspicious_files = []

    for root, dirs, files in os.walk(scan_path):
        dirs[:] = [d for d in dirs if d not in (
            "node_modules", ".git", "__pycache__", ".next", "dist", "build",
            ".wrangler", ".cloudflare", "coverage"
        )]

        for file in files:
            file_path = Path(root) / file
            rel_path = str(file_path.relative_to(scan_path))
            rel_lower = rel_path.lower()

            keywords = ["dorm_students", "users", "password", "secret", "token",
                        "backup", "dump", "export", "migrate", "import"]
            for kw in keywords:
                if kw.lower() in rel_lower:
                    try:
                        size = file_path.stat().st_size
                    except:
                        size = 0
                    suspicious_files.append((rel_path, size))
                    break

    if not suspicious_files:
        print(f"{Colors.GREEN}✅ 未发现含敏感关键词的本地文件。{Colors.END}")
        return True

    print(f"
{Colors.YELLOW}⚠️  发现以下含敏感关键词的本地文件（仅报告，不动文件）:{Colors.END}")
    print(f"{'文件路径':<50} {'大小':>10}")
    print("-" * 65)
    for f, size in sorted(suspicious_files, key=lambda x: x[1], reverse=True)[:30]:
        size_str = f"{size/1024:.1f} KB" if size < 1024*1024 else f"{size/1024/1024:.2f} MB"
        print(f"   {f:<50} {size_str:>10}")

    if len(suspicious_files) > 30:
        print(f"   ... 还有 {len(suspicious_files)-30} 个")

    print(f"
{Colors.CYAN}💡 提示：这些文件留在本地是安全的，只要确保它们不在 .gitignore 保护下被 push 到远程即可。{Colors.END}")
    return True


# =====================================================================
# 主程序
# =====================================================================

def main():
    print_banner()

    print(f"{Colors.CYAN}当前配置:{Colors.END}")
    print(f"   Cloudflare 项目: {CF_PROJECT_NAME}")
    print(f"   Git 仓库: {GIT_REPO_PATH}")
    print(f"   本地扫描: {LOCAL_SCAN_PATH}")
    print(f"   {Colors.GREEN}承诺：本地文件一个不动。{Colors.END}")
    print()

    if not ask("确认开始云端清理？"):
        print(f"{Colors.GREEN}已取消。{Colors.END}")
        sys.exit(0)

    results = {}

    if ask("执行 Cloudflare Pages 历史部署清理？"):
        results["cloudflare"] = run_cf_cleanup()
    else:
        results["cloudflare"] = None

    if ask("执行 Git 历史清理（本地文件保留）？"):
        results["git"] = run_git_cleanup()
    else:
        results["git"] = None

    if ask("执行本地文件扫描（仅报告）？"):
        results["local_scan"] = run_local_scan()
    else:
        results["local_scan"] = None

    # 总结
    print(f"
{Colors.BOLD}{Colors.CYAN}══════════════════════════════════════════════════════════════{Colors.END}")
    print(f"{Colors.BOLD}                      云端清理报告{Colors.END}")
    print(f"{Colors.CYAN}══════════════════════════════════════════════════════════════{Colors.END}")

    for name, status in results.items():
        if status is None:
            label = f"{Colors.YELLOW}⏹️  已跳过{Colors.END}"
        elif status:
            label = f"{Colors.GREEN}✅ 已完成{Colors.END}"
        else:
            label = f"{Colors.RED}❌ 失败/异常{Colors.END}"
        print(f"   {name.upper():<15} {label}")

    print(f"
{Colors.BOLD}{Colors.YELLOW}📋 后续检查清单:{Colors.END}")
    print(f"   ☐ 登录 Cloudflare Dashboard → Pages → {CF_PROJECT_NAME} → Deployments")
    print(f"     确认只剩 1 个部署（当前线上版）")
    print(f"   ☐ 登录 GitHub → 你的仓库 → Commits")
    print(f"     确认历史中没有 .json 数据文件，commit hash 已改变")
    print(f"   ☐ 确认本地文件全部保留（没有被删除）")
    print(f"   ☐ 确认 .gitignore 已包含敏感文件模式，防止误 push")

    print(f"
{Colors.GREEN}{Colors.BOLD}🏁 云端清理流程结束。本地文件未动。{Colors.END}")


if __name__ == "__main__":
    main()
