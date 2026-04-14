# -*- coding: utf-8 -*-
import pandas as pd
import json
import sys

# 设置输出编码
sys.stdout.reconfigure(encoding='utf-8')

# 读取Excel文件
df = pd.read_excel('信息大队22-25级女生信息.xlsx', header=None)

# 初始化数据结构
dormData = {}
nameIndex = {}

# 年级映射（列区域）
grade_columns = [
    (0, 4, "2022级"),
    (5, 9, "2023级"),
    (10, 14, "2024级"),
    (15, 19, "2025级"),
]

# 跟踪每列区域当前的宿舍号
current_dorms = {}

# 逐行解析数据（跳过表头第0行）
for _, row in df.iloc[1:].iterrows():
    for start, end, grade in grade_columns:
        dorm = row[start]
        class_name = row[start + 1]
        name = row[start + 2]
        bed = row[start + 3]
        
        # 跳过空行
        if pd.isna(dorm) and pd.isna(class_name) and pd.isna(name):
            continue
        
        # 处理宿舍号 - 如果当前行为空，继承之前记录的宿舍号
        dorm_key = (start, grade)
        if pd.notna(dorm):
            try:
                current_dorms[dorm_key] = str(int(dorm))
            except:
                current_dorms[dorm_key] = str(dorm).strip()
        
        dorm = current_dorms.get(dorm_key)
        
        class_name = str(class_name).strip() if pd.notna(class_name) else None
        name = str(name).strip() if pd.notna(name) else None
        
        # 处理床号（可能是数字或"106-3"格式）
        bed_num = None
        if pd.notna(bed):
            bed_str = str(bed).strip()
            if '-' in bed_str:
                # 特殊格式如"106-3"，提取床号
                parts = bed_str.split('-')
                dorm = parts[0]
                bed_num = int(parts[1])
            else:
                try:
                    bed_num = int(float(bed_str))
                except:
                    bed_num = None
        
        # 跳过没有姓名或班级的数据
        if not name or not class_name:
            continue
        
        # 跳过没有宿舍号的数据（数据不完整）
        if not dorm:
            continue
        
        # 初始化年级
        if grade not in dormData:
            dormData[grade] = {}
        
        # 初始化班级
        if class_name not in dormData[grade]:
            dormData[grade][class_name] = {}
        
        # 初始化宿舍
        if dorm not in dormData[grade][class_name]:
            dormData[grade][class_name][dorm] = [None, None, None, None]
        
        # 填充床位
        if bed_num and 1 <= bed_num <= 4:
            dormData[grade][class_name][dorm][bed_num - 1] = name
        
        # 添加到姓名索引
        nameIndex[name] = {
            "grade": grade,
            "className": class_name,
            "dorm": dorm,
            "bed": bed_num if bed_num else 1
        }

# 转换为JavaScript代码
def to_js_code(obj, indent=0):
    spaces = "  " * indent
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = []
        for k, v in obj.items():
            items.append(f'{spaces}  "{k}": {to_js_code(v, indent + 1)}')
        return "{\n" + ",\n".join(items) + f"\n{spaces}}}"
    elif isinstance(obj, list):
        if not obj:
            return "[]"
        items = [to_js_code(item, indent) for item in obj]
        return "[" + ", ".join(items) + "]"
    elif isinstance(obj, str):
        return f'"{obj}"'
    elif obj is None:
        return "null"
    else:
        return str(obj)

# 生成验证代码
validation_code = '''
// ============ 验证代码 ============
(function() {
  let totalCount = 0;
  let tangInfo = null;
  
  for (const grade in dormData) {
    let gradeCount = 0;
    for (const className in dormData[grade]) {
      for (const dorm in dormData[grade][className]) {
        const beds = dormData[grade][className][dorm];
        for (let i = 0; i < beds.length; i++) {
          if (beds[i]) {
            gradeCount++;
            if (beds[i] === "唐杨曦") {
              tangInfo = { grade, className, dorm, bed: i + 1 };
            }
          }
        }
      }
    }
    console.log(`${grade}: ${gradeCount}人`);
    totalCount += gradeCount;
  }
  
  console.log(`总人数：${totalCount}人`);
  
  // 验证唐杨曦
  if (tangInfo) {
    console.log("\\n【唐杨曦验证】");
    console.log(`年级: ${tangInfo.grade}`);
    console.log(`班级: ${tangInfo.className}`);
    console.log(`宿舍: ${tangInfo.dorm}`);
    console.log(`床位: ${tangInfo.bed}`);
    if (tangInfo.dorm === "106" && tangInfo.bed === 3) {
      console.log("OK: 唐杨曦已正确分配到106-3");
    } else {
      console.log("ERROR: 唐杨曦分配错误！");
    }
  } else {
    console.log("\\nERROR: 未找到唐杨曦！");
  }
})();
'''

# 生成完整的JS文件
js_content = f'''// dormData.js
// 晚寝查寝系统数据结构
// 自动生成，请勿手动修改

const dormData = {to_js_code(dormData, 0)};

const nameIndex = {to_js_code(nameIndex, 0)};

// 导出（兼容浏览器和Node.js）
if (typeof module !== 'undefined' && module.exports) {{
  module.exports = {{ dormData, nameIndex }};
}}

{validation_code}
'''

# 写入文件
with open('dormData.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

print("dormData.js generated successfully")
print(f"Total students: {len(nameIndex)}")
print(f"Name index entries: {len(nameIndex)}")

# 数据摘要
print("\nSummary:")
for grade in dormData:
    student_count = sum(
        sum(1 for d in dormData[grade][c] for name in dormData[grade][c][d] if name)
        for c in dormData[grade]
    )
    dorm_count = sum(len(dormData[grade][c]) for c in dormData[grade])
    print(f"  {grade}: {student_count} students, {dorm_count} dorms")

# 检查唐杨曦
if "唐杨曦" in nameIndex:
    info = nameIndex["唐杨曦"]
    print(f"\n唐杨曦: {info['dorm']}-{info['bed']}")
else:
    print("\n唐杨曦 not found!")
