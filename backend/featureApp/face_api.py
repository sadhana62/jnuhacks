import mysql.connector
import json
import numpy as np
from deepface import DeepFace
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import logging
import cv2
import uuid
from werkzeug.utils import secure_filename

# ---------------- Logging ----------------
logging.basicConfig(level=logging.INFO)

# ---------------- Flask ----------------
app = Flask(__name__)
CORS(app)

# ---------------- Build model ONCE (speed fix) ----------------
DeepFace.build_model("ArcFace")

# ---------------- DB helper (critical fix) ----------------
def get_db():
    conn = mysql.connector.connect(
        host="server.rwebservice.in",
        user="face_attadance",
        password="face_attadance",
        database="face_attadance",
        autocommit=True
    )
    return conn, conn.cursor(buffered=True)

# ---------------- Boundary (RELAXED) ----------------
BOUNDARY_X1, BOUNDARY_Y1 = 100, 50
BOUNDARY_X2, BOUNDARY_Y2 = 540, 430

def is_out_of_boundary(face):
    x, y, w, h = face
    cx = x + w // 2
    cy = y + h // 2
    return not (BOUNDARY_X1 <= cx <= BOUNDARY_X2 and BOUNDARY_Y1 <= cy <= BOUNDARY_Y2)

# ---------------- Similarity ----------------
def cosine_similarity(a, b):
    a, b = np.array(a), np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# ==================================================
# ===================== ENROLL =====================
# ==================================================
@app.route("/enroll", methods=["POST"])
def enroll():
    temp = None
    conn = cur = None
    try:
        sid = request.form.get("sid")
        image = request.files.get("image")

        if not sid or not image:
            return jsonify({"success": False, "message": "Missing input"})

        os.makedirs("temp", exist_ok=True)
        temp = f"temp/{uuid.uuid4()}.jpg"
        image.save(temp)

        emb = DeepFace.represent(
            img_path=temp,
            model_name="ArcFace",
            enforce_detection=False
        )[0]["embedding"]

        conn, cur = get_db()
        cur.execute(
            "INSERT INTO student_face (sid, embedding) VALUES (%s,%s)",
            (sid, json.dumps(emb))
        )

        return jsonify({"success": True, "message": "Enrolled successfully"})

    except Exception as e:
        logging.exception("Enroll error")
        return jsonify({"success": False, "message": str(e)})

    finally:
        if cur: cur.close()
        if conn: conn.close()
        if temp and os.path.exists(temp): os.remove(temp)

# ==================================================
# =================== ATTENDANCE ===================
# ==================================================
@app.route("/attendance", methods=["POST"])
def attendance():
    temp = None
    try:
        sid = request.form.get("sid")
        image = request.files.get("image")

        if not sid or not image:
            return jsonify({"success": False, "status": "INVALID_INPUT"})

        os.makedirs("temp", exist_ok=True)
        temp = f"temp/{uuid.uuid4()}.jpg"
        image.save(temp)

        img = cv2.imread(temp)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        faces = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        ).detectMultiScale(gray, 1.3, 5)

        if len(faces) == 0:
            return jsonify({"success": False, "status": "NO_FACE"})

        for f in faces:
            if is_out_of_boundary(f):
                return jsonify({"success": False, "status": "OUT_OF_BOUNDARY"})

        return jsonify(verify(sid, temp))

    except Exception as e:
        logging.exception("Attendance error")
        return jsonify({"success": False, "status": "ERROR", "message": str(e)})

    finally:
        if temp and os.path.exists(temp): os.remove(temp)

# ==================================================
# ================= VERIFY ==========================
# ==================================================
def verify(sid, img, threshold=0.75):
    conn = cur = None
    try:
        emb = DeepFace.represent(
            img_path=img,
            model_name="ArcFace",
            enforce_detection=False
        )[0]["embedding"]

        conn, cur = get_db()
        cur.execute("SELECT embedding FROM student_face WHERE sid=%s", (sid,))
        rows = cur.fetchall()

        for (e,) in rows:
            sim = cosine_similarity(emb, json.loads(e))
            print("SIMILARITY:", sim)
            if sim > (1 - threshold):
                cur.execute(
                    "INSERT INTO face_attendance (sid,status) VALUES (%s,'P')",
                    (sid,)
                )
                return {"success": True, "status": "MATCHED"}

        return {"success": False, "status": "NOT_MATCHED"}

    finally:
        if cur: cur.close()
        if conn: conn.close()

# ==================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
