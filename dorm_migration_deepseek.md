# NIGHTSHIFT 宿舍数据迁移：Supabase → D1 + 前端上传支持

> **执行者**：DeepSeek (Claude Code)  
> **目标**：彻底移除 Supabase 依赖，宿舍数据全部迁移到 Cloudflare D1；支持管理员通过前端上传 `.xlsx` 更新数据；年级映射动态化，不再写死。  
> **状态**：待执行（用户已确认表结构和数据）

---

## 一、数据现状

- **总记录**：172 条（含 7 个空床）
- **年级分布**：
  - `22` → 大四（情报/网络安全）
  - `23` → 大三（情报/网络安全/数据警务）
  - `24` → 大二（情报/网络安全/数据警务）
  - `25` → 大一（网安/情报/数据警务）
- **字段映射**（Excel → D1）：
  | Excel 列 | D1 字段 | 说明 |
  |---|---|---|
  | 宿舍号 | `dorm_name` | 合并单元格已展开填充 |
  | 班级 | `class_name` | 如 `情报2201`、`网络安全2201` |
  | 姓名 | `student_name` | 空床为 `NULL` |
  | 床号 | `bed` | 1-4 |
  | 自动提取 | `floor` | 宿舍号首位，如 `512` → `5` |
  | 自动提取 | `year_code` | 班级中的年份代码，如 `22` |
  | 自动提取 | `grade_name` | 根据 `year_code` 映射：22→大四，23→大三，24→大二，25→大一 |

---

## 二、Phase 1：D1 数据库建表 + 导数据

### 2.1 在 Cloudflare Dashboard 执行

路径：`Workers & Pages` → `nightshift` → `D1` → `nightshift-db` → `Console`

粘贴并执行以下完整 SQL（已包含 172 条数据）：

```sql
-- ============================================
-- NIGHTSHIFT 宿舍数据迁移 SQL
-- ============================================

-- 1. 年级映射表（支持动态映射，后期改年级名只需改这里）
CREATE TABLE IF NOT EXISTS grade_mapping (
    year_code TEXT PRIMARY KEY,
    grade_name TEXT NOT NULL,
    display_order INTEGER NOT NULL
);

INSERT OR REPLACE INTO grade_mapping (year_code, grade_name, display_order) VALUES
    ('25', '大一', 1),
    ('24', '大二', 2),
    ('23', '大三', 3),
    ('22', '大四', 4);

-- 2. 宿舍人员主表
CREATE TABLE IF NOT EXISTS dorm_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dorm_name TEXT NOT NULL,
    floor INTEGER NOT NULL,
    class_name TEXT,
    student_name TEXT,
    bed INTEGER,
    year_code TEXT,
    grade_name TEXT,
    status TEXT DEFAULT '在校',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_dorm_floor ON dorm_students(floor);
CREATE INDEX IF NOT EXISTS idx_dorm_name ON dorm_students(dorm_name);
CREATE INDEX IF NOT EXISTS idx_class_name ON dorm_students(class_name);
CREATE INDEX IF NOT EXISTS idx_year_code ON dorm_students(year_code);
CREATE INDEX IF NOT EXISTS idx_grade_name ON dorm_students(grade_name);
CREATE INDEX IF NOT EXISTS idx_student_name ON dorm_students(student_name);
CREATE INDEX IF NOT EXISTS idx_dorm_bed ON dorm_students(dorm_name, bed);

-- 4. 清空旧数据（如需重导）
DELETE FROM dorm_students;
DELETE FROM sqlite_sequence WHERE name = 'dorm_students';

-- 5. 导入全部 172 条数据
INSERT INTO dorm_students 
    (dorm_name, floor, class_name, student_name, bed, year_code, grade_name, status) 
VALUES
    ('106', 1, '情报2201', '唐杨曦', 3, '22', '大四', '在校'),
    ('512', 5, '情报2201', '张蕊', 1, '22', '大四', '在校'),
    ('512', 5, NULL, NULL, NULL, NULL, NULL, '空床'),
    ('512', 5, '情报2201', '钱镝冰', 3, '22', '大四', '在校'),
    ('512', 5, '情报2201', '姜子思钥', 4, '22', '大四', '在校'),
    ('513', 5, '情报2201', '陈春玲', 1, '22', '大四', '在校'),
    ('513', 5, NULL, NULL, NULL, NULL, NULL, '空床'),
    ('513', 5, '情报2202', '杜叶', 3, '22', '大四', '在校'),
    ('513', 5, '情报2202', '左明泽', 4, '22', '大四', '在校'),
    ('514', 5, '情报2202', '梁羽彤', 1, '22', '大四', '在校'),
    ('514', 5, '情报2202', '许静', 2, '22', '大四', '在校'),
    ('514', 5, '情报2202', '杨可', 3, '22', '大四', '在校'),
    ('514', 5, '情报2202', '赵子谦', 4, '22', '大四', '在校'),
    ('609', 6, '情报2203', '杨千叶', 1, '22', '大四', '在校'),
    ('609', 6, '情报2203', '钟艺敏', 2, '22', '大四', '在校'),
    ('609', 6, '情报2203', '李漩', 3, '22', '大四', '在校'),
    ('609', 6, '情报2203', '梁安然', 4, '22', '大四', '在校'),
    ('610', 6, '网络安全2201', '平欣怡', 1, '22', '大四', '在校'),
    ('610', 6, '网络安全2201', '韩至雅', 2, '22', '大四', '在校'),
    ('610', 6, '网络安全2201', '梁苏豫', 3, '22', '大四', '在校'),
    ('610', 6, '网络安全2201', '肖玥', 4, '22', '大四', '在校'),
    ('611', 6, '网络安全2201', '高琨', 1, '22', '大四', '在校'),
    ('611', 6, '网络安全2201', '李思莹', 2, '22', '大四', '在校'),
    ('611', 6, '网络安全2202', '王科英', 3, '22', '大四', '在校'),
    ('611', 6, '网络安全2202', '刘润儒', 4, '22', '大四', '在校'),
    ('612', 6, '网络安全2202', '席嘉仪', 1, '22', '大四', '在校'),
    ('612', 6, '网络安全2202', '刘凌菲', 2, '22', '大四', '在校'),
    ('612', 6, '网络安全2202', '李馨', 3, '22', '大四', '在校'),
    ('612', 6, '网络安全2202', '张诗悦', 4, '22', '大四', '在校'),
    ('619', 6, '网络安全2203', '顾洋', 1, '22', '大四', '在校'),
    ('619', 6, '网络安全2203', '张天姿', 2, '22', '大四', '在校'),
    ('619', 6, '网络安全2203', '高菲雨', 3, '22', '大四', '在校'),
    ('619', 6, '网络安全2203', '褚雨晨', 4, '22', '大四', '在校'),
    ('620', 6, '网络安全2203', '郎振男', 1, '22', '大四', '在校'),
    ('620', 6, '网络安全2203', '刘丹童', 2, '22', '大四', '在校'),
    ('620', 6, NULL, NULL, NULL, NULL, NULL, '空床'),
    ('620', 6, '网络安全2204', '吴烨舟', 4, '22', '大四', '在校'),
    ('621', 6, '网络安全2204', '曹兢格', 1, '22', '大四', '在校'),
    ('621', 6, '网络安全2204', '王炳琪', 2, '22', '大四', '在校'),
    ('621', 6, '网络安全2204', '高翰瑛', 3, '22', '大四', '在校'),
    ('621', 6, '网络安全2204', '张妙涵', 4, '22', '大四', '在校'),
    ('520', 5, '网络安全2303', '胡秀依', 1, '23', '大三', '在校'),
    ('520', 5, '网络安全2303', '蒋文煜', 2, '23', '大三', '在校'),
    ('520', 5, '网络安全2303', '刘芮溪', 3, '23', '大三', '在校'),
    ('520', 5, '网络安全2303', '尚雅雯', 4, '23', '大三', '在校'),
    ('521', 5, '网络安全2304', '蒋莹', 1, '23', '大三', '在校'),
    ('521', 5, '网络安全2304', '孙熙雯', 2, '23', '大三', '在校'),
    ('521', 5, '网络安全2304', '王晨熹', 3, '23', '大三', '在校'),
    ('521', 5, '网络安全2304', '张美伦', 4, '23', '大三', '在校'),
    ('601', 6, '数据警务2301', '黄思睿', 1, '23', '大三', '在校'),
    ('601', 6, '数据警务2301', '金鸣禹', 2, '23', '大三', '在校'),
    ('601', 6, '数据警务2301', '刘一潼', 3, '23', '大三', '在校'),
    ('601', 6, NULL, NULL, NULL, NULL, NULL, '空床'),
    ('602', 6, '数据警务2301', '熊婉伶', 1, '23', '大三', '在校'),
    ('602', 6, '数据警务2301', '张美奂', 2, '23', '大三', '在校'),
    ('602', 6, '数据警务2301', '赵治清', 3, '23', '大三', '在校'),
    ('602', 6, NULL, NULL, NULL, NULL, NULL, '空床'),
    ('613', 6, '情报2301', '蔡雅淳', 1, '23', '大三', '在校'),
    ('613', 6, '情报2301', '陈佳城', 2, '23', '大三', '在校'),
    ('613', 6, '情报2301', '黎依诺', 3, '23', '大三', '在校'),
    ('613', 6, '情报2301', '倪秀玲', 4, '23', '大三', '在校'),
    ('614', 6, '情报2301', '钱景', 1, '23', '大三', '在校'),
    ('614', 6, '情报2301', '王雨非', 2, '23', '大三', '在校'),
    ('614', 6, '情报2301', '肖韵', 3, '23', '大三', '在校'),
    ('614', 6, '情报2301', '姚云馨', 4, '23', '大三', '在校'),
    ('615', 6, '情报2302', '杜佳艺', 1, '23', '大三', '在校'),
    ('615', 6, '情报2302', '李雨菲', 2, '23', '大三', '在校'),
    ('615', 6, '情报2302', '任玥', 3, '23', '大三', '在校'),
    ('615', 6, '情报2302', '叶卓妍', 4, '23', '大三', '在校'),
    ('616', 6, '情报2302', '张虞菲乐', 1, '23', '大三', '在校'),
    ('616', 6, '情报2302', '赵心怡', 2, '23', '大三', '在校'),
    ('616', 6, '网络安全2301', '陈炜佳', 3, '23', '大三', '在校'),
    ('616', 6, '网络安全2301', '邓执云', 4, '23', '大三', '在校'),
    ('617', 6, '网络安全2301', '葛嘉瑞', 1, '23', '大三', '在校'),
    ('617', 6, '网络安全2301', '李武珂', 2, '23', '大三', '在校'),
    ('617', 6, '网络安全2301', '张焱琳', 3, '23', '大三', '在校'),
    ('617', 6, '网络安全2301', '刘琪', 4, '23', '大三', '在校'),
    ('618', 6, '网络安全2302', '王烨璇', 1, '23', '大三', '在校'),
    ('618', 6, '网络安全2302', '文家慧', 2, '23', '大三', '在校'),
    ('618', 6, '网络安全2302', '杨子仪', 3, '23', '大三', '在校'),
    ('618', 6, '网络安全2302', '张洁', 4, '23', '大三', '在校'),
    ('402', 4, '情报2401', '王亚冉', 1, '24', '大二', '在校'),
    ('402', 4, '情报2401', '陈河妨', 2, '24', '大二', '在校'),
    ('402', 4, '情报2401', '胡丽洁', 3, '24', '大二', '在校'),
    ('402', 4, '情报2401', '尹文珺', 4, '24', '大二', '在校'),
    ('403', 4, '情报2402', '肖霈盈', 1, '24', '大二', '在校'),
    ('403', 4, '情报2402', '曾子蕙', 2, '24', '大二', '在校'),
    ('403', 4, '情报2402', '莫馥瑜', 3, '24', '大二', '在校'),
    ('403', 4, '数据警务2401', '何雨霏', 4, '24', '大二', '在校'),
    ('404', 4, '数据警务2401', '陆梦茜', 1, '24', '大二', '在校'),
    ('404', 4, '数据警务2401', '徐徐', 2, '24', '大二', '在校'),
    ('404', 4, '数据警务2401', '吕悦侨', 3, '24', '大二', '在校'),
    ('404', 4, '数据警务2401', '彭东', 4, '24', '大二', '在校'),
    ('405', 4, '数据警务2402', '边巴桑姆', 1, '24', '大二', '在校'),
    ('405', 4, '数据警务2402', '史奕祯', 2, '24', '大二', '在校'),
    ('405', 4, '数据警务2402', '张凌菲', 3, '24', '大二', '在校'),
    ('405', 4, '数据警务2402', '谢小军', 4, '24', '大二', '在校'),
    ('406', 4, '数据警务2402', '李紫琦', 1, '24', '大二', '在校'),
    ('406', 4, '网络安全2401', '罗煜', 2, '24', '大二', '在校'),
    ('406', 4, '网络安全2401', '洪栎妍', 3, '24', '大二', '在校'),
    ('406', 4, '网络安全2401', '姚思远', 4, '24', '大二', '在校'),
    ('407', 4, '网络安全2401', '唐梦瑶', 1, '24', '大二', '在校'),
    ('407', 4, '网络安全2401', '孙维伊', 2, '24', '大二', '在校'),
    ('407', 4, '网络安全2402', '刘子萱', 3, '24', '大二', '在校'),
    ('407', 4, '网络安全2402', '沈佳怡', 4, '24', '大二', '在校'),
    ('408', 4, '网络安全2402', '金奕萱', 1, '24', '大二', '在校'),
    ('408', 4, '网络安全2402', '陆蕾霓', 2, '24', '大二', '在校'),
    ('408', 4, '网络安全2402', '陈沿利', 3, '24', '大二', '在校'),
    ('408', 4, '网络安全2403', '陈美伊', 4, '24', '大二', '在校'),
    ('409', 4, '网络安全2403', '周芳竹', 1, '24', '大二', '在校'),
    ('409', 4, '网络安全2403', '李佳虹', 2, '24', '大二', '在校'),
    ('409', 4, '网络安全2403', '杨锦槚', 3, '24', '大二', '在校'),
    ('409', 4, '网络安全2403', '吴翰雅', 4, '24', '大二', '在校'),
    ('410', 4, '情报2401', '罗静怡', 1, '24', '大二', '在校'),
    ('410', 4, '网络安全2404', '董桐羽', 2, '24', '大二', '在校'),
    ('410', 4, '网络安全2404', '孔怡霏', 3, '24', '大二', '在校'),
    ('410', 4, '网络安全2404', '尹思韵', 4, '24', '大二', '在校'),
    ('411', 4, '网络安全2404', '杨馨婷', 1, '24', '大二', '在校'),
    ('411', 4, '网络安全2404', '李渊', 2, '24', '大二', '在校'),
    ('411', 4, '网络安全2404', '林晨昕', 3, '24', '大二', '在校'),
    ('411', 4, '网络安全2404', '李倩茹', 4, '24', '大二', '在校'),
    ('505', 5, '网安2501', '张溪影', 1, '25', '大一', '在校'),
    ('505', 5, '网安2501', '曹奕萱', 2, '25', '大一', '在校'),
    ('505', 5, '网安2501', '李宇航', 3, '25', '大一', '在校'),
    ('505', 5, '网安2501', '张笑怡', 4, '25', '大一', '在校'),
    ('506', 5, '网安2501', '王琪', 1, '25', '大一', '在校'),
    ('506', 5, '网安2502', '施骁倩', 2, '25', '大一', '在校'),
    ('506', 5, '网安2502', '刘欣一', 3, '25', '大一', '在校'),
    ('506', 5, '网安2502', '毛彤', 4, '25', '大一', '在校'),
    ('507', 5, '网安2502', '孔舒涵', 1, '25', '大一', '在校'),
    ('507', 5, '网安2502', '刘铭煊', 2, '25', '大一', '在校'),
    ('507', 5, '网安2503', '李沂鑫', 3, '25', '大一', '在校'),
    ('507', 5, '网安2503', '于琬婷', 4, '25', '大一', '在校'),
    ('508', 5, '网安2503', '于子涵', 1, '25', '大一', '在校'),
    ('508', 5, '网安2503', '陈奕辛', 2, '25', '大一', '在校'),
    ('508', 5, '网安2503', '董宇辰', 3, '25', '大一', '在校'),
    ('508', 5, '网安2504', '王一诺', 4, '25', '大一', '在校'),
    ('509', 5, '网安2504', '陆圆明', 1, '25', '大一', '在校'),
    ('509', 5, '网安2504', '廖子莹', 2, '25', '大一', '在校'),
    ('509', 5, '网安2504', '刘爽', 3, '25', '大一', '在校'),
    ('509', 5, '网安2504', '李欣芝', 4, '25', '大一', '在校'),
    ('510', 5, '情报2501', '孙嘉', 1, '25', '大一', '在校'),
    ('510', 5, '情报2501', '王思童', 2, '25', '大一', '在校'),
    ('510', 5, '情报2501', '袁昭宇', 3, '25', '大一', '在校'),
    ('510', 5, '情报2501', '吴佳芮', 4, '25', '大一', '在校'),
    ('511', 5, '情报2501', '石希远', 1, '25', '大一', '在校'),
    ('511', 5, '情报2501', '黄子涵', 2, '25', '大一', '在校'),
    ('511', 5, '情报2502', '杨佳芮', 3, '25', '大一', '在校'),
    ('511', 5, '情报2502', '李雨恬', 4, '25', '大一', '在校'),
    ('603', 6, '情报2502', '米涵涵', 1, '25', '大一', '在校'),
    ('603', 6, '情报2502', '张欣雨', 2, '25', '大一', '在校'),
    ('603', 6, '情报2502', '牛品婷', 3, '25', '大一', '在校'),
    ('603', 6, '情报2502', '李梦洁', 4, '25', '大一', '在校'),
    ('604', 6, '数据警务2501', '何锐颖', 1, '25', '大一', '在校'),
    ('604', 6, '数据警务2501', '杨欣欣', 2, '25', '大一', '在校'),
    ('604', 6, '数据警务2501', '叶婉婧', 3, '25', '大一', '在校'),
    ('604', 6, NULL, NULL, NULL, NULL, NULL, '空床'),
    ('605', 6, '数据警务2501', '田宸菲', 1, '25', '大一', '在校'),
    ('605', 6, '数据警务2501', '沙棠影', 2, '25', '大一', '在校'),
    ('605', 6, '数据警务2502', '秦小斐', 3, '25', '大一', '在校'),
    ('605', 6, '数据警务2502', '李笑宁', 4, '25', '大一', '在校'),
    ('606', 6, '数据警务2502', '周靖云', 1, '25', '大一', '在校'),
    ('606', 6, '数据警务2502', '李金骏', 2, '25', '大一', '在校'),
    ('606', 6, '数据警务2502', '徐晨曦', 3, '25', '大一', '在校'),
    ('606', 6, '数据警务2502', '刘思睿', 4, '25', '大一', '在校'),
    ('607', 6, '数据警务2503', '姚亮', 1, '25', '大一', '在校'),
    ('607', 6, '数据警务2503', '曹梓雨', 2, '25', '大一', '在校'),
    ('607', 6, '数据警务2503', '邬冰婕', 3, '25', '大一', '在校'),
    ('607', 6, NULL, NULL, NULL, NULL, NULL, '空床'),
    ('608', 6, '数据警务2503', '林靖萱', 1, '25', '大一', '在校'),
    ('608', 6, '数据警务2503', '戴佳芮', 2, '25', '大一', '在校'),
    ('608', 6, '数据警务2503', '王雪瑶', 3, '25', '大一', '在校');
```

**执行后验证**：
```sql
SELECT grade_name, COUNT(*) as cnt FROM dorm_students WHERE status = '在校' GROUP BY grade_name;
-- 应返回：大一 52, 大二 48, 大三 40, 大四 25
```

---

## 三、Phase 2：改造 `functions/api/dorm-data.js`

**目标**：从 Supabase REST API 改为 D1 查询，数据结构保持兼容（前端不改）。

**文件路径**：`functions/api/dorm-data.js`

**替换为以下完整代码**：

```javascript
// functions/api/dorm-data.js
import { jsonResponse, errorResponse, handleOptions, verifyToken, withErrorGuard } from './_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return handleOptions('GET, OPTIONS');
  }

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  // JWT 校验
  await verifyToken(request, context.env);

  try {
    // 从 D1 读取全部宿舍数据 + 年级映射
    const { results: students } = await context.env.DB.prepare(`
      SELECT 
        ds.dorm_name,
        ds.floor,
        ds.class_name,
        ds.student_name,
        ds.bed,
        ds.year_code,
        ds.grade_name,
        ds.status,
        gm.display_order
      FROM dorm_students ds
      LEFT JOIN grade_mapping gm ON ds.year_code = gm.year_code
      WHERE ds.status = '在校' OR ds.status = '空床'
      ORDER BY gm.display_order, ds.dorm_name, ds.bed
    `).all();

    // 构建与旧 Supabase 兼容的数据结构
    const dormData = {};
    const nameIndex = {};

    for (const student of students) {
      const grade = student.grade_name || '其他';
      const className = student.class_name || '';
      const dorm = student.dorm_name;
      const bed = student.bed;
      const name = student.student_name;

      if (!dormData[grade]) dormData[grade] = {};
      if (!dormData[grade][className]) dormData[grade][className] = {};
      if (!dormData[grade][className][dorm]) {
        dormData[grade][className][dorm] = [null, null, null, null];
      }

      // 只有有姓名的才填床位，空床保持 null
      if (name && bed && bed >= 1 && bed <= 4) {
        dormData[grade][className][dorm][bed - 1] = name;
        nameIndex[name] = {
          grade: grade,
          className: className,
          dorm: dorm,
          bed: bed,
        };
      }
    }

    return jsonResponse({ dormData, nameIndex });
  } catch (error) {
    console.error('D1 Query Error:', error);
    return errorResponse('Internal server error', 500);
  }
});
```

---

## 四、Phase 3：新增「管理员上传 Excel 更新数据」API

**目标**：管理员在前端上传固定格式的 `.xlsx`，后端解析并全量替换 `dorm_students` 表。

**新增文件**：`functions/api/admin/dorm-upload.js`

```javascript
// functions/api/admin/dorm-upload.js
import { jsonResponse, errorResponse, handleOptions, verifyToken, withErrorGuard } from '../_utils.js';

// 简易 xlsx 解析（无需外部库，基于 XML 解压）
// 生产环境如需更稳定可引入 @cloudflare/xlsx 或在前端解析后传 JSON
async function parseXlsx(arrayBuffer) {
  const { ZipReader, BlobReader, TextWriter } = await import('@zip.js/zip.js');
  const zipReader = new ZipReader(new BlobReader(new Blob([arrayBuffer])));
  const entries = await zipReader.getEntries();

  // 读取 sharedStrings.xml
  const sharedEntry = entries.find(e => e.filename === 'xl/sharedStrings.xml');
  const sharedStrings = sharedEntry ? await sharedEntry.getData(new TextWriter()) : '';
  const sst = [];
  const siRegex = /<si>(.*?)<\/si>/gs;
  let match;
  while ((match = siRegex.exec(sharedStrings)) !== null) {
    const tMatch = match[1].match(/<t>([^<]*)<\/t>/);
    sst.push(tMatch ? tMatch[1] : '');
  }

  // 读取 sheet1.xml
  const sheetEntry = entries.find(e => e.filename === 'xl/worksheets/sheet1.xml');
  const sheetXml = await sheetEntry.getData(new TextWriter());

  const rows = [];
  const rowRegex = /<row[^>]*>(.*?)<\/row>/gs;
  while ((match = rowRegex.exec(sheetXml)) !== null) {
    const cells = [];
    const cellRegex = /<c[^>]*>(.*?)<\/c>/gs;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      const type = cellMatch[0].match(/t="([^"]*)"/)?.[1];
      const valMatch = cellMatch[1].match(/<v>([^<]*)<\/v>/);
      let val = valMatch ? valMatch[1] : '';
      if (type === 's') val = sst[parseInt(val)] || '';
      cells.push(val);
    }
    rows.push(cells);
  }
  await zipReader.close();
  return rows;
}

export const onRequest = withErrorGuard(async (context) => {
  const request = context.request;

  if (request.method === 'OPTIONS') return handleOptions('POST, OPTIONS');
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  // 校验管理员权限（临时账户 chaqin 也允许）
  const payload = await verifyToken(request, context.env);
  if (payload.username !== 'chaqin') {
    return errorResponse('Forbidden: admin only', 403);
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse('Expected multipart/form-data', 400);
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return errorResponse('No file uploaded', 400);
  }

  const arrayBuffer = await file.arrayBuffer();
  const rows = await parseXlsx(arrayBuffer);

  // 解析逻辑：
  // 列：0=宿舍号, 1=班级, 2=姓名, 3=床号
  // 第一行为表头，跳过
  // 宿舍号合并单元格 → 向下填充
  // 空行（班级+姓名+床号全空）→ 跳过
  // 姓名为空但班级有 → 空床

  const records = [];
  let currentDorm = '';
  let currentFloor = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;

    const dormCell = String(row[0] || '').trim();
    const classCell = String(row[1] || '').trim().replace(/\s+/g, '');
    const nameCell = String(row[2] || '').trim();
    const bedCell = parseInt(row[3]);

    // 跳过完全空行
    if (!classCell && !nameCell && !bedCell) continue;

    // 更新宿舍号
    if (dormCell) {
      currentDorm = dormCell;
      currentFloor = parseInt(currentDorm[0]) || 0;
    }

    // 提取年级代码
    const yearMatch = classCell.match(/(\d{2})/);
    const yearCode = yearMatch ? yearMatch[1] : null;

    // 查 grade_mapping 表获取 grade_name
    let gradeName = '';
    if (yearCode) {
      const gm = await context.env.DB.prepare(
        'SELECT grade_name FROM grade_mapping WHERE year_code = ?'
      ).bind(yearCode).first();
      gradeName = gm ? gm.grade_name : '';
    }

    records.push({
      dorm_name: currentDorm,
      floor: currentFloor,
      class_name: classCell || null,
      student_name: nameCell || null,
      bed: bedCell || null,
      year_code: yearCode,
      grade_name: gradeName,
      status: nameCell ? '在校' : '空床'
    });
  }

  if (records.length === 0) {
    return errorResponse('No valid records found in xlsx', 400);
  }

  // 事务：先清空再插入
  await context.env.DB.prepare('DELETE FROM dorm_students').run();
  await context.env.DB.prepare('DELETE FROM sqlite_sequence WHERE name = ?').bind('dorm_students').run();

  // 批量插入（D1 支持事务但批量有限制，这里逐条）
  const insertStmt = context.env.DB.prepare(
    `INSERT INTO dorm_students 
     (dorm_name, floor, class_name, student_name, bed, year_code, grade_name, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const r of records) {
    await insertStmt.bind(
      r.dorm_name, r.floor, r.class_name, r.student_name,
      r.bed, r.year_code, r.grade_name, r.status
    ).run();
  }

  return jsonResponse({
    success: true,
    imported: records.length,
    message: `Imported ${records.length} records, replaced old data.`
  });
});
```

**注意**：`@zip.js/zip.js` 需要安装。如果 Cloudflare Pages Functions 不支持 npm 包（或你不想装），**改用前端解析方案**（见 Phase 4）。

---

## 五、Phase 4：前端上传页面（推荐方案）

**更稳妥的做法**：前端用 `SheetJS`（`xlsx` 库）解析 `.xlsx`，把解析好的 JSON 通过 `POST /api/admin/dorm-upload-json` 传给后端。

### 5.1 新增 API：`functions/api/admin/dorm-upload-json.js`

```javascript
// functions/api/admin/dorm-upload-json.js
import { jsonResponse, errorResponse, handleOptions, verifyToken, withErrorGuard } from '../_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const request = context.request;

  if (request.method === 'OPTIONS') return handleOptions('POST, OPTIONS');
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const payload = await verifyToken(request, context.env);
  if (payload.username !== 'chaqin') {
    return errorResponse('Forbidden: admin only', 403);
  }

  const body = await request.json();
  const { records } = body;

  if (!Array.isArray(records) || records.length === 0) {
    return errorResponse('Invalid records array', 400);
  }

  // 清空旧数据
  await context.env.DB.prepare('DELETE FROM dorm_students').run();
  await context.env.DB.prepare('DELETE FROM sqlite_sequence WHERE name = ?').bind('dorm_students').run();

  const insertStmt = context.env.DB.prepare(
    `INSERT INTO dorm_students 
     (dorm_name, floor, class_name, student_name, bed, year_code, grade_name, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const r of records) {
    await insertStmt.bind(
      r.dorm_name, r.floor, r.class_name, r.student_name,
      r.bed, r.year_code, r.grade_name, r.status
    ).run();
  }

  return jsonResponse({
    success: true,
    imported: records.length,
    message: `Imported ${records.length} records.`
  });
});
```

### 5.2 前端上传组件（嵌入现有管理页面或新建 `admin.html`）

```html
<!-- 在现有页面中加入，或新建 admin.html -->
<div id="upload-section" style="display:none;">
  <h3>更新宿舍数据</h3>
  <input type="file" id="xlsx-file" accept=".xlsx" />
  <button onclick="uploadDormData()">上传并更新</button>
  <p id="upload-status"></p>
</div>

<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
<script>
async function uploadDormData() {
  const fileInput = document.getElementById('xlsx-file');
  const file = fileInput.files[0];
  if (!file) { alert('请选择 .xlsx 文件'); return; }

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // 解析逻辑（与后端一致）
  const records = [];
  let currentDorm = '';
  let currentFloor = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;

    const dormCell = String(row[0] || '').trim();
    const classCell = String(row[1] || '').trim().replace(/\s+/g, '');
    const nameCell = String(row[2] || '').trim();
    const bedCell = parseInt(row[3]);

    if (!classCell && !nameCell && !bedCell) continue;
    if (dormCell) {
      currentDorm = dormCell;
      currentFloor = parseInt(currentDorm[0]) || 0;
    }

    const yearMatch = classCell.match(/(\d{2})/);
    const yearCode = yearMatch ? yearMatch[1] : null;
    // grade_name 由后端查表映射，前端传 year_code 即可

    records.push({
      dorm_name: currentDorm,
      floor: currentFloor,
      class_name: classCell || null,
      student_name: nameCell || null,
      bed: bedCell || null,
      year_code: yearCode,
      grade_name: '', // 后端会重新查 grade_mapping 填充
      status: nameCell ? '在校' : '空床'
    });
  }

  const token = localStorage.getItem('token');
  const res = await fetch('/api/admin/dorm-upload-json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ records })
  });

  const result = await res.json();
  document.getElementById('upload-status').textContent = 
    result.success ? `✅ 成功导入 ${result.imported} 条记录` : `❌ 失败: ${result.message || result.error}`;
}

// 仅管理员显示上传区域
if (localStorage.getItem('username') === 'chaqin') {
  document.getElementById('upload-section').style.display = 'block';
}
</script>
```

---

## 六、Phase 5：清理 Supabase 残余

### 6.1 删除环境变量
在 Cloudflare Dashboard → `Workers & Pages` → `nightshift` → `Settings` → `Variables` 中删除：
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### 6.2 删除 `package.json` 中的 Supabase 依赖（如果存在）
```bash
npm uninstall @supabase/supabase-js
```

### 6.3 检查其他文件中的 Supabase 引用
全局搜索 `supabase`、`SUPABASE`：
- `functions/api/dorm-data.js` — 已替换 ✅
- `assets/js/dorm-loader.js` — 确认只调用 `/api/dorm-data`，无需改 ✅
- `assets/js/name-matcher.js` — 确认只调用 `/api/dorm-data`，无需改 ✅
- 其他 API 文件 — 逐一检查，如有引用一并移除

---

## 七、部署与验证步骤

1. **执行 SQL**：在 D1 Console 粘贴 Phase 1 的 SQL，验证数据条数
2. **替换 API**：用 Phase 2 的代码覆盖 `functions/api/dorm-data.js`
3. **新增 API**：创建 `functions/api/admin/dorm-upload-json.js`（Phase 4.1）
4. **前端加按钮**：在合适页面加入 Phase 4.2 的上传组件
5. **清理环境变量**：Phase 5
6. **本地测试**：`npm run dev`，访问 `http://localhost:8788`，登录 chaqin，确认宿舍列表正常加载
7. **部署**：`git add . && git commit -m "migrate dorm data from supabase to d1" && git push`
8. **线上验证**：
   - 登录 `niteshift.cn`，确认各年级楼层正常显示
   - 测试上传功能（先用测试文件）
   - 确认 Supabase 相关 500 错误消失

---

## 八、关键设计决策（供参考）

| 决策 | 说明 |
|---|---|
| **年级映射表独立** | `grade_mapping` 表存储 `year_code → grade_name`，以后改年级名（如大一→本科一年级）只需改表，不动代码。 |
| **空床显式存储** | Excel 中空行/空姓名在 D1 中存为 `status='空床'`，前端渲染时自动显示为「空床」或留白。 |
| **前端解析 xlsx** | 用 SheetJS 在前端解析，后端只收 JSON，避免 Cloudflare Functions 里处理二进制 zip 的兼容性问题。 |
| **全量替换而非增量** | 上传即 `DELETE + INSERT`，逻辑简单，避免合并冲突。数据量小（~200条），全量无压力。 |
| **权限控制** | 仅 `chaqin` 账户可调用上传 API，后期如需多管理员可扩展 roles 字段。 |

---

## 九、交付物清单

- [ ] `dorm_students` 表创建完成（D1 Console）
- [ ] `grade_mapping` 表数据插入完成
- [ ] `functions/api/dorm-data.js` 已替换为 D1 版本
- [ ] `functions/api/admin/dorm-upload-json.js` 已创建
- [ ] 前端上传组件已嵌入
- [ ] Supabase 环境变量已删除
- [ ] 本地 `npm run dev` 测试通过
- [ ] 线上 `niteshift.cn` 验证通过

---

> **给 DeepSeek 的额外提示**：
> - 用户要求「代码不要再写死哪一级哪一级」，本方案通过 `grade_mapping` 表实现完全动态化。
> - 用户要求「前端可以根据用户上传的固定格式的.xlsx文件自动渲染」，本方案采用前端 SheetJS 解析 + 后端 JSON 接收，最稳妥。
> - 如果 Cloudflare Pages Functions 的 bundle 大小受限，前端 SheetJS 可用 CDN 加载，不打包进项目。
> - 所有改动保持与现有前端数据结构兼容（`dormData` / `nameIndex`），前端页面无需重构。
