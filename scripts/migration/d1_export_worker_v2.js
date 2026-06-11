// d1_export_worker_v2.js
// 精准版：导出全部14张表 + 建表语句 + 数据
// 部署方式：npx wrangler deploy d1_export_worker_v2.js --name d1-export-v2

export default {
  async fetch(request, env, ctx) {
    const TABLES = [
      'users',
      'rooms',
      'room_members',
      'room_states',
      'room_logs',
      'room_messages',
      'check_sessions',
      'check_records',
      'single_check_records',
      'dorm_students',
      'grade_mapping',
      'settings',
      'system_logs',
      'login_logs'
    ];

    const exportData = {};
    const errors = [];

    for (const table of TABLES) {
      try {
        // 获取建表语句
        const schemaRes = await env.DB.prepare(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
        ).bind(table).first();

        // 获取所有数据
        const { results } = await env.DB.prepare(
          `SELECT * FROM ${table}`
        ).all();

        // 获取索引信息
        const { results: indexes } = await env.DB.prepare(
          `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?`
        ).bind(table).all();

        exportData[table] = {
          schema: schemaRes ? schemaRes.sql : null,
          indexes: indexes || [],
          count: results.length,
          data: results
        };
      } catch (e) {
        errors.push({ table, error: e.message });
        exportData[table] = { schema: null, indexes: [], count: 0, data: [], error: e.message };
      }
    }

    // 额外导出 KV 敏感词库信息
    let kvInfo = null;
    try {
      const kvList = await env.SENSITIVE_WORDS.list();
      const wordsData = await env.SENSITIVE_WORDS.get('sensitive_words');
      kvInfo = {
        namespace_exists: true,
        keys_count: kvList.keys ? kvList.keys.length : 0,
        words_preview: wordsData ? wordsData.substring(0, 500) : null,
        words_total_length: wordsData ? wordsData.length : 0
      };
    } catch (e) {
      kvInfo = { error: e.message };
    }

    return new Response(JSON.stringify({
      exported_at: new Date().toISOString(),
      database_id: env.DB ? env.DB.databaseId : 'unknown',
      tables: TABLES,
      data: exportData,
      kv_sensitive_words: kvInfo,
      errors: errors.length > 0 ? errors : null
    }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
