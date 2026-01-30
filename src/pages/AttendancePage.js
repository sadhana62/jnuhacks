import React, { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/library";

/* ================= VOICE ASSISTANT ================= */
const speak = (() => {
  let lastText = "";
  let lastTime = 0;
  let audioUnlocked = false;
  const COOLDOWN = 2500;

  return (text) => {
    if (!audioUnlocked) {
      const unlock = new SpeechSynthesisUtterance("Voice assistance enabled");
      window.speechSynthesis.speak(unlock);
      audioUnlocked = true;
    }

    const now = Date.now();
    if (text === lastText && now - lastTime < COOLDOWN) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.lang = "en-US";

    window.speechSynthesis.speak(utterance);
    lastText = text;
    lastTime = now;
  };
})();
/* =================================================== */

export default function AttendancePage() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [studentId, setStudentId] = useState("");
  const [message, setMessage] = useState(null);
  const [seatNumber, setSeatNumber] = useState(null);
  const [autoMode, setAutoMode] = useState(false);
  const [verificationCount, setVerificationCount] = useState(0);
  const autoIntervalRef = useRef(null);
  const isVerifyingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        window.stream = s;
        if (video) {
          video.srcObject = s;
          initQRScanner();
        }
      })
      .catch((err) => {
        showMessage("Error accessing camera: " + err.message, "error");
      });

    return () => {
      stopAutoMode();
      if (video?.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        window.stream = null;
      }
    };
  }, []);

  const initQRScanner = () => {
    const codeReader = new BrowserQRCodeReader();
    codeReader.decodeFromVideoDevice(null, videoRef.current, (result) => {
      if (result) {
        const sid = extractStudentId(result.getText());
        if (sid) {
          setStudentId(sid);
          showMessage("QR detected. Verifying attendance…", "success");
          verifyAttendance();
        } else {
          showMessage("Invalid QR Code format.", "error");
        }
      }
    });
  };

  const extractStudentId = (qrContent) => {
    try {
      const data = JSON.parse(qrContent);
      if (data.type === "student" && data.id) return data.id;
    } catch {}
    return null;
  };

  const showMessage = (text, type) => setMessage({ text, type });

  const toggleAutoMode = () => {
    if (autoMode) stopAutoMode();
    else {
      setAutoMode(true);
      setVerificationCount(0);
      autoIntervalRef.current = setInterval(verifyAttendance, 5000);
    }
  };

  const stopAutoMode = () => {
    setAutoMode(false);
    clearInterval(autoIntervalRef.current);
    setVerificationCount(0);
  };

  const verifyAttendance = async () => {
    if (!studentId || isVerifyingRef.current) return;
    isVerifyingRef.current = true;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) return;

      const formData = new FormData();
      formData.append("sid", studentId);
      formData.append("image", blob);

      try {
        showMessage(`Verifying… (Attempt ${verificationCount + 1}/5)`, "auto");

        const res = await fetch("http://localhost:5000/attendance", {
          method: "POST",
          body: formData
        });
        const data = await res.json();

        if (data.status === "OUT_OF_BOUNDARY") {
          showMessage("Stay inside the frame", "error");
          speak("Please stay inside the frame");
        } else if (data.status === "NO_FACE") {
          showMessage("No face detected", "error");
          speak("Please look at the camera");
        } else if (data.status === "NOT_MATCHED") {
          showMessage("Face not matched", "error");
          speak("Face not matched");
        } else if (data.status === "MATCHED") {
          showMessage("Attendance marked successfully", "success");
          speak("Attendance marked successfully");
          stopAutoMode();
        }

        setVerificationCount(v => v + 1);
      } catch {
        showMessage("Verification failed", "error");
      } finally {
        isVerifyingRef.current = false;
      }
    }, "image/jpeg", 0.8);
  };

  /* ===================== STYLES ===================== */
  const pageStyle = {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #667eea, #764ba2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "Inter, Segoe UI, sans-serif",
  };

  const cardStyle = {
    background: "rgba(255,255,255,0.95)",
    padding: "2.5rem",
    borderRadius: "24px",
    width: "380px",
    boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
    textAlign: "center",
  };

  const inputStyle = {
    width: "100%",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid #ddd",
    marginBottom: "1rem",
    fontSize: "1rem",
  };

  const videoStyle = {
    width: "100%",
    borderRadius: "16px",
    border: "3px solid #667eea",
    marginBottom: "1rem",
  };

  const buttonStyle = {
    padding: "10px 18px",
    borderRadius: "10px",
    border: "none",
    margin: "0 6px",
    fontWeight: 600,
    cursor: "pointer",
    background: "linear-gradient(135deg, #667eea, #764ba2)",
    color: "#fff",
  };

  const messageStyle = {
    marginTop: "1rem",
    padding: "10px",
    borderRadius: "10px",
    fontWeight: 600,
    background:
      message?.type === "success"
        ? "#e6fffa"
        : message?.type === "error"
        ? "#ffe6e6"
        : "#fff3cd",
    color:
      message?.type === "success"
        ? "#065f46"
        : message?.type === "error"
        ? "#842029"
        : "#856404",
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h2 style={{ marginBottom: "1rem" }}>📸 Smart Attendance</h2>

        <input
          style={inputStyle}
          value={studentId}
          onChange={e => setStudentId(e.target.value)}
          placeholder="Student ID or QR"
        />

        <video ref={videoRef} autoPlay playsInline style={videoStyle} />
        <canvas ref={canvasRef} style={{ display: "none" }} />

        <div>
          <button style={buttonStyle} onClick={verifyAttendance}>Verify</button>
          <button
            style={{ ...buttonStyle, background: autoMode ? "#dc2626" : "#16a34a" }}
            onClick={toggleAutoMode}
          >
            {autoMode ? "Stop Auto" : "Start Auto"}
          </button>
        </div>

        {message && <div style={messageStyle}>{message.text}</div>}
        {seatNumber && <div style={{ marginTop: 10, fontWeight: 700 }}>Seat: {seatNumber}</div>}
      </div>
    </div>
  );
}
