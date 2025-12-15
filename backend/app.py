"""
作者: s2814398
日期: 2025
"""

from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import oracledb as cx_Oracle
import json
import csv
import io
import os
from flask import send_from_directory
from werkzeug.exceptions import NotFound

app = Flask(__name__)
CORS(app)

ORACLE_USER = os.environ.get("ORACLE_USER")
ORACLE_PASSWORD = os.environ.get("ORACLE_PASSWORD")
ORACLE_DSN = os.environ.get("ORACLE_DSN", "172.16.108.21:1842/GLRNLIVE_PRMY.is.ed.ac.uk")

DDB_CONFIG = {
  'user': os.environ.get("ORACLE_USER", "s2814398"),
  'password': os.environ.get("ORACLE_PASSWORD", "20031223ZYk"),
  'dsn': os.environ.get("ORACLE_DSN", "172.16.108.21:1842/GLRNLIVE_PRMY.is.ed.ac.uk")
}

def get_db_connection():
    try:
        user = os.environ.get("ORACLE_USER")
        password = os.environ.get("ORACLE_PASSWORD")
        dsn = os.environ.get("ORACLE_DSN") or "172.16.108.21:1842/GLRNLIVE_PRMY.is.ed.ac.uk"

        if not user or not password:
            raise RuntimeError("ORACLE_USER/ORACLE_PASSWORD env not set")

        # 打印一下确认你现在到底用的哪个 DSN（会进 gunicorn-error.log）
        print("DB CONNECT USING DSN =", dsn)

        return cx_Oracle.connect(user=user, password=password, dsn=dsn)
    except Exception as e:
        print("数据库连接错误:", e)
        return None

# 3D模型映射
GREENSPACE_3D_MODELS = {
    'Baberton Golf Course': 'Baberton Golf Course',
    'Campbell Park': 'Campbell Park',
    'Carrick Knowe Golf Course': 'Carrick Knowe Golf Course',
    'Colinton and Craiglockhart Dells': 'Colinton and Craiglockhart Dells',
    'Kingsknowe Golf Course': 'Kingsknowe Golf Course',
    'Oriam': 'Oriam',
    'Red Hall Public Park': 'Red Hall Publice Park',
    'Redhall Public Park': 'Red Hall Publice Park',
    'Saughton Cemetery': 'Saughton Cemetery',
    'Saughton Park': 'Saughton Park',
    'Saughton Park and Gardens': 'Saughton Park',
    'Spylaw Public Park': 'Spylaw Public Park',
}

def get_3d_model_path(greenspace_name):
    if not greenspace_name:
        return None
    if greenspace_name in GREENSPACE_3D_MODELS:
        return f"3d_models/{GREENSPACE_3D_MODELS[greenspace_name]}/index.html"
    name_lower = greenspace_name.lower()
    for db_name, folder_name in GREENSPACE_3D_MODELS.items():
        if db_name.lower() in name_lower or name_lower in db_name.lower():
            return f"3d_models/{folder_name}/index.html"
    return None

# ============================================================
# API - 研究区域
# ============================================================
@app.route('/api/study_area', methods=['GET'])
def get_study_area():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT area_id, area_name, pva_reference, geom_json
            FROM STUDY_AREA
            WHERE geom_json IS NOT NULL
        """)

        rows = cursor.fetchall()
        print("study_area rows fetched:", len(rows))

        features = []
        fail = 0

        for (area_id, area_name, pva_ref, geom_json) in rows:
            if geom_json is None:
                continue

            # 1) 读出 geom_json
            geom_str = geom_json.read() if hasattr(geom_json, "read") else geom_json

            # 2) 处理 bytes -> str
            if isinstance(geom_str, (bytes, bytearray)):
                geom_str = geom_str.decode("utf-8", errors="ignore")

            # 3) 处理非 str 的情况
            if not isinstance(geom_str, str):
                geom_str = str(geom_str)

            geom_str = geom_str.strip()

            # 4) 解析 JSON
            try:
                obj = json.loads(geom_str)
            except Exception as e:
                fail += 1
                if fail <= 5:  # 只打印前 5 个，避免刷屏
                    print("study_area json.loads failed:", e)
                    print("sample:", geom_str[:120])
                continue

            # 5) 兼容不同存储格式
            # 情况A：直接是坐标数组 [[lng,lat],...]
            if isinstance(obj, list):
                geometry = {"type": "Polygon", "coordinates": [obj]}

            # 情况B：标准 geometry dict {"type": "...", "coordinates": ...}
            elif isinstance(obj, dict) and ("type" in obj and "coordinates" in obj):
                geometry = obj

            # 情况C：存的是 Feature / FeatureCollection
            elif isinstance(obj, dict) and obj.get("type") == "Feature":
                geometry = obj.get("geometry")
            else:
                fail += 1
                if fail <= 5:
                    print("study_area unknown geom_json format, keys:", list(obj.keys())[:10] if isinstance(obj, dict) else type(obj))
                continue

            if not geometry:
                continue

            features.append({
                "type": "Feature",
                "properties": {
                    "area_id": int(area_id) if area_id is not None else None,
                    "area_name": area_name,
                    "pva_reference": pva_ref,
                },
                "geometry": geometry
            })

        print("study_area features built:", len(features), "failed:", fail)

        return jsonify({"type": "FeatureCollection", "features": features})

    except Exception as e:
        # 这里不要只捕获 cx_Oracle.Error，因为 JSON/类型错误也会发生
        return jsonify({'error': str(e)}), 500

    finally:
        try:
            if cursor:
                cursor.close()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass

# ============================================================
# API - SIMD分区（使用SIMD_DECILE字段！）
# ============================================================
@app.route('/api/simd_zones', methods=['GET'])
def get_simd_zones():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = conn.cursor()
        
        # 获取筛选参数
        risk_level = request.args.get('risk_level', None)
        min_val = request.args.get('min', None, type=float)
        max_val = request.args.get('max', None, type=float)
        
        # 使用 SIMD_DECILE 字段进行筛选（不是RISK_INDEX！）
        sql = """
            SELECT simd_zone_id, datazone_code, datazone_name, 
                   simd_decile, risk_index, simd_rank, geom_json
            FROM SIMD_ZONE
            WHERE geom_json IS NOT NULL
        """
        
        # 按风险等级筛选（基于SIMD_DECILE）
        # SIMD_DECILE: 1=最贫困(高风险), 10=最富裕(低风险)
        if risk_level:
            if risk_level == 'high':
                sql += " AND simd_decile BETWEEN 1 AND 3"
            elif risk_level == 'medium':
                sql += " AND simd_decile BETWEEN 4 AND 7"
            elif risk_level == 'low':
                sql += " AND simd_decile BETWEEN 8 AND 10"
        
        # 自定义区间筛选
        if min_val is not None:
            sql += f" AND simd_decile >= {min_val}"
        if max_val is not None:
            sql += f" AND simd_decile <= {max_val}"
        
        cursor.execute(sql)
        
        features = []
        for row in cursor:
            zone_id, dz_code, dz_name, simd_dec, risk_idx, simd_rank, geom_json = row
            if geom_json:
                geom_str = geom_json.read() if hasattr(geom_json, 'read') else str(geom_json)
                try:
                    geometry = json.loads(geom_str)
                    features.append({
                        'type': 'Feature',
                        'properties': {
                            'simd_zone_id': zone_id,
                            'datazone_code': dz_code,
                            'datazone_name': dz_name,
                            'simd_decile': int(simd_dec) if simd_dec else None,
                            'risk_index': float(risk_idx) if risk_idx else 0,
                            'simd_rank': int(simd_rank) if simd_rank else None
                        },
                        'geometry': geometry
                    })
                except: pass
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'type': 'FeatureCollection',
            'features': features,
            'metadata': {
                'total_count': len(features),
                'filter': risk_level,
                'note': 'Using SIMD_DECILE for classification (1=most deprived, 10=least deprived)'
            }
        })
    except cx_Oracle.Error as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# API - 绿地
# ============================================================
@app.route('/api/greenspaces', methods=['GET'])
def get_greenspaces():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = conn.cursor()
        gs_type = request.args.get('type', None)
        min_storage = request.args.get('min_storage', None, type=float)
        max_storage = request.args.get('max_storage', None, type=float)
        
        sql = """
            SELECT greenspace_id, name, function_type, 
                   storage_volume_m3, is_key_greenspace, geom_json
            FROM GREENSPACE WHERE geom_json IS NOT NULL
        """
        
        if gs_type == 'key':
            sql += " AND is_key_greenspace = 1"
        elif gs_type == 'other':
            sql += " AND (is_key_greenspace = 0 OR is_key_greenspace IS NULL)"
        
        if min_storage is not None:
            sql += f" AND storage_volume_m3 >= {min_storage}"
        if max_storage is not None:
            sql += f" AND storage_volume_m3 <= {max_storage}"
        
        cursor.execute(sql)
        
        features = []
        for row in cursor:
            gs_id, name, func_type, storage, is_key, geom_json = row
            if geom_json:
                geom_str = geom_json.read() if hasattr(geom_json, 'read') else str(geom_json)
                try:
                    geometry = json.loads(geom_str)
                    model_path = get_3d_model_path(name) if is_key else None
                    features.append({
                        'type': 'Feature',
                        'properties': {
                            'greenspace_id': gs_id,
                            'name': name,
                            'function_type': func_type,
                            'storage_volume_m3': float(storage) if storage else 0,
                            'is_key_greenspace': bool(is_key),
                            'has_3d_model': model_path is not None,
                            'model_path': model_path
                        },
                        'geometry': geometry
                    })
                except: pass
        
        cursor.close()
        conn.close()
        return jsonify({'type': 'FeatureCollection', 'features': features})
    except cx_Oracle.Error as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# API - 洪水区域
# ============================================================
@app.route('/api/flood_zones', methods=['GET'])
def get_flood_zones():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = conn.cursor()
        depth = request.args.get('depth', None)
        
        sql = """
            SELECT zone_id, probability, depth_band, scenario, geom_json
            FROM FLOOD_ZONE WHERE geom_json IS NOT NULL
        """
        
        if depth == 'shallow':
            sql += " AND depth_band LIKE '%< 0.3%'"
        elif depth == 'medium':
            sql += " AND depth_band LIKE '%0.3%1.0%'"
        elif depth == 'deep':
            sql += " AND depth_band LIKE '%> 1.0%'"
        
        cursor.execute(sql)
        
        features = []
        for row in cursor:
            zone_id, prob, depth_band, scenario, geom_json = row
            if geom_json:
                geom_str = geom_json.read() if hasattr(geom_json, 'read') else str(geom_json)
                try:
                    geometry = json.loads(geom_str)
                    features.append({
                        'type': 'Feature',
                        'properties': {
                            'zone_id': zone_id,
                            'probability': prob,
                            'depth_band': depth_band,
                            'scenario': scenario
                        },
                        'geometry': geometry
                    })
                except: pass
        
        cursor.close()
        conn.close()
        return jsonify({'type': 'FeatureCollection', 'features': features})
    except cx_Oracle.Error as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# API - 建筑物损失
# ============================================================
@app.route('/api/flood_damage', methods=['GET'])
def get_flood_damage():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = conn.cursor()
        building_type = request.args.get('type', None)
        min_value = request.args.get('min_value', None, type=float)
        max_value = request.args.get('max_value', None, type=float)
        
        sql = """
            SELECT damage_id, building_id, building_category,
                   flood_depth_m, damage_2024_pound, 
                   damage_protected_pound, protection_value_pound, geom_json
            FROM FLOOD_DAMAGE WHERE geom_json IS NOT NULL
        """
        
        if building_type:
            sql += f" AND LOWER(building_category) LIKE LOWER('%{building_type}%')"
        if min_value is not None:
            sql += f" AND protection_value_pound >= {min_value}"
        if max_value is not None:
            sql += f" AND protection_value_pound <= {max_value}"
        
        cursor.execute(sql)
        
        features = []
        max_protection = 0
        min_protection = float('inf')
        
        for row in cursor:
            (damage_id, building_id, category, depth, 
             damage_2024, damage_protected, protection_value, geom_json) = row
            if geom_json:
                geom_str = geom_json.read() if hasattr(geom_json, 'read') else str(geom_json)
                try:
                    geometry = json.loads(geom_str)
                    pv = float(protection_value) if protection_value else 0
                    if pv > max_protection: max_protection = pv
                    if pv < min_protection and pv > 0: min_protection = pv
                    
                    features.append({
                        'type': 'Feature',
                        'properties': {
                            'damage_id': damage_id,
                            'building_id': building_id,
                            'building_category': category,
                            'flood_depth_m': float(depth) if depth else 0,
                            'damage_2024_pound': float(damage_2024) if damage_2024 else 0,
                            'damage_protected_pound': float(damage_protected) if damage_protected else 0,
                            'protection_value_pound': pv
                        },
                        'geometry': geometry
                    })
                except: pass
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'type': 'FeatureCollection',
            'features': features,
            'metadata': {
                'max_protection_value': max_protection,
                'min_protection_value': min_protection if min_protection != float('inf') else 0,
                'total_count': len(features)
            }
        })
    except cx_Oracle.Error as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# API - 汇总统计
# ============================================================
@app.route('/api/summary', methods=['GET'])
def get_summary():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = conn.cursor()
        summary = {}
        
        cursor.execute("""
            SELECT COUNT(*), SUM(damage_2024_pound), 
                   SUM(damage_protected_pound), SUM(protection_value_pound)
            FROM FLOOD_DAMAGE
        """)
        row = cursor.fetchone()
        if row:
            summary['affected_buildings'] = row[0]
            summary['total_damage_2024'] = float(row[1]) if row[1] else 0
            summary['total_damage_protected'] = float(row[2]) if row[2] else 0
            summary['total_protection_value'] = float(row[3]) if row[3] else 0
        
                # 选定绿地的存储量
            cursor.execute("""
                 SELECT SUM(storage_volume_m3), COUNT(*) 
                FROM GREENSPACE 
                 WHERE LOWER(name) IN (
                    'spylaw public park',
                    'colinton and craiglockhart dells',
                    'hailes quarry park',
                    'saughton allotments',
                    'saughton sports complex',
                    'saughton rose gardens',
                    'saughton park and gardens',
                    'murray field',
                    'roseburn public park'
                 )
        """)
        row = cursor.fetchone()
        summary['total_storage_m3'] = float(row[0]) if row[0] else 0
        summary['greenspace_count'] = row[1]
        
        cursor.execute("SELECT COUNT(*) FROM SIMD_ZONE")
        summary['simd_zone_count'] = cursor.fetchone()[0]
        
        if summary.get('total_damage_2024', 0) > 0:
            summary['protection_percentage'] = round(
                summary['total_protection_value'] / summary['total_damage_2024'] * 100, 1
            )
        else:
            summary['protection_percentage'] = 73.0
        
        cursor.close()
        conn.close()
        return jsonify(summary)
    except cx_Oracle.Error as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# API - 按类型统计
# ============================================================
@app.route('/api/damage_by_category', methods=['GET'])
def get_damage_by_category():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT building_category, COUNT(*), 
                   SUM(damage_2024_pound), SUM(protection_value_pound)
            FROM FLOOD_DAMAGE
            GROUP BY building_category
            ORDER BY SUM(protection_value_pound) DESC
        """)
        
        result = []
        for row in cursor:
            result.append({
                'category': row[0],
                'count': row[1],
                'total_damage': float(row[2]) if row[2] else 0,
                'total_protection': float(row[3]) if row[3] else 0
            })
        
        cursor.close()
        conn.close()
        return jsonify(result)
    except cx_Oracle.Error as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# API - 绿地排名
# ============================================================
@app.route('/api/greenspace_ranking', methods=['GET'])
def get_greenspace_ranking():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = conn.cursor()
        limit = request.args.get('limit', 10, type=int)
        
        cursor.execute(f"""
            SELECT greenspace_id, name, function_type, storage_volume_m3, is_key_greenspace
            FROM GREENSPACE
            WHERE storage_volume_m3 IS NOT NULL
            ORDER BY storage_volume_m3 DESC
            FETCH FIRST {limit} ROWS ONLY
        """)
        
        result = []
        for row in cursor:
            gs_id, name, func_type, storage, is_key = row
            model_path = get_3d_model_path(name) if is_key else None
            result.append({
                'greenspace_id': gs_id,
                'name': name,
                'function_type': func_type,
                'storage_volume_m3': float(storage) if storage else 0,
                'is_key_greenspace': bool(is_key),
                'has_3d_model': model_path is not None
            })
        
        cursor.close()
        conn.close()
        return jsonify(result)
    except cx_Oracle.Error as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# API - 数据导出
# ============================================================
@app.route('/api/export/<data_type>', methods=['GET'])
def export_data(data_type):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = conn.cursor()
        format_type = request.args.get('format', 'csv')
        
        if data_type == 'flood_damage':
            cursor.execute("""
                SELECT damage_id, building_id, building_category, flood_depth_m,
                       damage_2024_pound, damage_protected_pound, protection_value_pound
                FROM FLOOD_DAMAGE
            """)
            columns = ['damage_id', 'building_id', 'building_category', 'flood_depth_m',
                      'damage_2024_pound', 'damage_protected_pound', 'protection_value_pound']
            filename = 'flood_damage_data'
            
        elif data_type == 'greenspaces':
            cursor.execute("""
                SELECT greenspace_id, name, function_type, storage_volume_m3, is_key_greenspace
                FROM GREENSPACE
            """)
            columns = ['greenspace_id', 'name', 'function_type', 'storage_volume_m3', 'is_key_greenspace']
            filename = 'greenspace_data'
            
        elif data_type == 'simd_zones':
            cursor.execute("""
                SELECT simd_zone_id, datazone_code, datazone_name, simd_decile, simd_rank, risk_index
                FROM SIMD_ZONE
            """)
            columns = ['simd_zone_id', 'datazone_code', 'datazone_name', 'simd_decile', 'simd_rank', 'risk_index']
            filename = 'simd_zone_data'
            
        elif data_type == 'summary':
            # 返回汇总统计
            cursor.execute("""
                SELECT 'Total Buildings' as metric, COUNT(*) as value FROM FLOOD_DAMAGE
                UNION ALL
                SELECT 'Total Damage (2024)', SUM(damage_2024_pound) FROM FLOOD_DAMAGE
                UNION ALL
                SELECT 'Total Protection Value', SUM(protection_value_pound) FROM FLOOD_DAMAGE
                UNION ALL
                SELECT 'Total Greenspaces', COUNT(*) FROM GREENSPACE
                UNION ALL
                SELECT 'Total Storage (m3)', SUM(storage_volume_m3) FROM GREENSPACE
            """)
            columns = ['metric', 'value']
            filename = 'summary_statistics'
        else:
            return jsonify({'error': 'Invalid data type'}), 400
        
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if format_type == 'json':
            data = [dict(zip(columns, row)) for row in rows]
            return jsonify(data)
        else:  # CSV
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(columns)
            writer.writerows(rows)
            
            return Response(
                output.getvalue(),
                mimetype='text/csv',
                headers={'Content-Disposition': f'attachment; filename={filename}.csv'}
            )
    except cx_Oracle.Error as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# 健康检查
# ============================================================
@app.route('/api/health', methods=['GET'])
def health_check():
    conn = get_db_connection()
    if conn:
        conn.close()
        return jsonify({'status': 'healthy', 'database': 'connected', 'version': '4.0'})
    return jsonify({'status': 'unhealthy', 'database': 'disconnected'}), 500

@app.route('/api')
def index():
    return jsonify({
        'name': 'Water of Leith WebMap API',
        'version': '4.0',
        'features': ['SIMD_DECILE筛选', '区间筛选', '数据导出', '图表联动'],
        'endpoints': [
            '/api/study_area', '/api/simd_zones', '/api/greenspaces',
            '/api/flood_zones', '/api/flood_damage', '/api/summary',
            '/api/damage_by_category', '/api/greenspace_ranking',
            '/api/export/<type>', '/api/health'
        ]
    })
    
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    # 让 /api/* 继续走后端，不要被前端接管
    if path == "api" or path.startswith("api/"):
        raise NotFound()

    # 如果请求的是前端的真实文件（js/css/img等），就直接返回该文件
    full_path = os.path.join(FRONTEND_DIR, path)
    if path and os.path.isfile(full_path):
        return send_from_directory(FRONTEND_DIR, path)

    # 其他任何路径都回到前端首页（适合单页应用/刷新不404）
    return send_from_directory(FRONTEND_DIR, "index.html")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 55430))
    print(f"\n{'='*60}")
    print(f"  Water of Leith WebMap API ")
    print(f"  地址: http://0.0.0.0:{port}")
    print(f"{'='*60}\n")
    app.run(host='0.0.0.0', port=port, debug=False)
