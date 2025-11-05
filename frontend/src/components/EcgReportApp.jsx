/*
PTB-XL ECG Frontend (React)
Final integrated version:
- Upload ECG image
- Select 12 leads with cropping UI
- Convert to PTB-XL JSON via backend
- Display waveform previews (scaled to pixels/mV)
- Run mock ensemble analysis
- Download PDF report
*/

import React, { useState, useRef, useCallback } from "react";
import { jsPDF } from "jspdf";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

/* ----------------------- Lead Boundary Selector ----------------------- */
function LeadBoundarySelector({ imageSrc, onConfirm, onCancel }) {
  const [boxes, setBoxes] = useState([]);
  const [crop, setCrop] = useState({ unit: "px", width: 0, height: 0, x: 0, y: 0 });
  const [leadIdx, setLeadIdx] = useState(0);
  const leadNames = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];

  const onImageLoaded = useCallback((img) => {
    const cw = Math.round((img.width || 0) / 4);
    const ch = Math.round((img.height || 0) / 3);
    setCrop({ unit: "px", width: Math.max(40, cw), height: Math.max(40, ch), x: 10, y: 10 });
    return false;
  }, []);

  const commitCrop = () => {
    if (!crop?.width || !crop?.height) return;
    const next = { x1: Math.round(crop.x), y1: Math.round(crop.y),
                   x2: Math.round(crop.x + crop.width), y2: Math.round(crop.y + crop.height) };
    const updated = [...boxes, next];
    setBoxes(updated);
    if (updated.length >= 12) {
      onConfirm(updated);
    } else {
      setLeadIdx(updated.length);
      setCrop(c => ({ ...c, x: c.x + 20, y: c.y + 10 }));
    }
  };

  const resetLast = () => {
    if (!boxes.length) return;
    const updated = boxes.slice(0, -1);
    setBoxes(updated);
    setLeadIdx(updated.length);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl p-4">
        <h2 className="text-center text-lg font-semibold text-slate-800">
          Draw a box around lead #{leadIdx + 1} — <span className="text-sky-700">{leadNames[leadIdx]}</span>
        </h2>
        <p className="text-center text-xs text-slate-500 mb-3">
          Drag to size the box. Click <b>Set this lead</b>. Repeat until all 12 are selected.
        </p>

        <div className="border rounded-lg overflow-auto max-h-[70vh] p-2 bg-slate-50">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={() => {}}
            keepSelection
            ruleOfThirds={false}
            aspect={undefined}
          >
            <img src={imageSrc} alt="ECG" onLoad={(e) => onImageLoaded(e.currentTarget)} />
          </ReactCrop>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-xs text-slate-500">Selected: {boxes.length}/12</div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-md bg-gray-200" onClick={resetLast} disabled={!boxes.length}>
              Undo last
            </button>
            <button className="px-3 py-2 rounded-md bg-emerald-600 text-white" onClick={commitCrop}>
              Set this lead
            </button>
            <button className="px-3 py-2 rounded-md bg-rose-600 text-white" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-1">
          {boxes.map((b, i) => (
            <div key={i} className="text-[10px] p-1 border rounded bg-white text-center">
              {i+1}. {leadNames[i]}
              <div className="text-[9px] text-slate-500">
                ({b.x1},{b.y1})–({b.x2},{b.y2})
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Main App ------------------------------ */
export default function EcgReportApp() {
  const [patient, setPatient] = useState({ name: "", age: "", gender: "" });
  const [fileName, setFileName] = useState("");
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ptbxlPayload, setPtbxlPayload] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [showCropUI, setShowCropUI] = useState(false);
  const [leadBoxes, setLeadBoxes] = useState(null);
  const [pixelsPerMv, setPixelsPerMv] = useState(20);

  const inputRef = useRef(null);
  const BACKEND_URL = "http://127.0.0.1:5000";

  const onPatientChange = (e) => {
    const { name, value } = e.target;
    setPatient(p => ({ ...p, [name]: value }));
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please upload an image file (png, jpg, jpeg)");
    if (file.size > 10 * 1024 * 1024) return setError("File too large. Max 10MB.");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result);
      setShowCropUI(true);
      setLeadBoxes(null);
    };
    reader.readAsDataURL(file);
  };

  const handleLeadBoxesConfirm = (boxesPx) => {
    setLeadBoxes(boxesPx);
    setShowCropUI(false);
  };

  const convertToPtbxl = async () => {
    setError(null);
    if (!imageSrc) return setError("Upload an ECG image first.");
    if (!patient.name) return setError("Please enter patient name.");
    if (!leadBoxes || leadBoxes.length !== 12)
      return setError("Please mark all 12 lead regions before converting.");

    setLoading(true);
    try {
      const metadata = {
        patient_name: patient.name,
        patient_age: patient.age || null,
        patient_sex: patient.gender || null,
        recording_date: new Date().toISOString(),
        source_file: fileName,
        note: "Frontend-generated payload."
      };

      const payload = {
        metadata,
        image_base64: imageSrc,
        lead_boxes: leadBoxes.map(b => [b.y1, b.y2, b.x1, b.x2]),
        pixels_per_mv: Number(pixelsPerMv)
      };

      const res = await fetch(`${BACKEND_URL}/api/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      setPtbxlPayload(data.ptbxl_payload);
      setAnalysisResult(null);
    } catch (err) {
      console.error(err);
      setError("Error contacting backend");
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async () => {
    if (!ptbxlPayload) return setError("Convert first.");
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ptbxl: ptbxlPayload })
      });
      const data = await res.json();
      setAnalysisResult(data.result);
    } catch (err) {
      setError("Error analyzing ECG");
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = () => {
    if (!analysisResult || !ptbxlPayload)
      return setError("Run analysis first to generate report.");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.setFontSize(18);
    doc.text("ECG Analysis Report", 20, 20);
    doc.setFontSize(12);
    doc.text(`Patient: ${ptbxlPayload.metadata.patient_name || "-"}`, 20, 30);
    doc.text(`Age: ${ptbxlPayload.metadata.patient_age || "-"}`, 20, 36);
    doc.text(`Sex: ${ptbxlPayload.metadata.patient_sex || "-"}`, 20, 42);
    doc.text(`Cardiac axis (frontal): ${analysisResult.cardiac_axis?.frontal ?? "-"}°`, 20, 54);
    doc.text(`Rhythm: ${analysisResult.rhythm || "-"}`, 20, 60);
    doc.text("Probabilities:", 20, 72);
    let y = 78;
    for (const [k, v] of Object.entries(analysisResult.probabilities || {})) {
      doc.text(`${k}: ${(v * 100).toFixed(1)}%`, 24, y);
      y += 6;
    }
    if (imageSrc) {
      const fmt = imageSrc.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(imageSrc, fmt, 110, 30, 80, 60);
    }
    doc.save(`ecg_report_${ptbxlPayload.record_id}.pdf`);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex items-start justify-center">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-md p-6">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Cardiac Axis Analysis — ECG Report</h1>
            <p className="text-sm text-slate-500">Upload an ECG image, mark 12 lead regions, then convert and analyze.</p>
          </div>
          <div className="text-right text-xs text-slate-400">Medical UI Prototype</div>
        </header>

        <form className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <input name="name" value={patient.name} onChange={onPatientChange} placeholder="Patient name" className="p-3 border rounded-lg" />
              <input name="age" value={patient.age} onChange={onPatientChange} placeholder="Age" className="p-3 border rounded-lg" />
              <select name="gender" value={patient.gender} onChange={onPatientChange} className="p-3 border rounded-lg">
                <option value="">Select gender</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </div>

            <div className="border-2 border-dashed rounded-lg p-4 text-center">
              <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
              <div className="flex items-center justify-center gap-4">
                <button type="button" onClick={() => inputRef.current?.click()} className="px-4 py-2 bg-sky-600 text-white rounded-lg">
                  Upload ECG Image
                </button>
                <div className="text-sm text-slate-500">or drag & drop (not implemented)</div>
              </div>
              {fileName && <div className="mt-3 text-xs text-slate-600">Uploaded: {fileName}</div>}
              {imageSrc && <img src={imageSrc} alt="ecg-preview" className="mt-4 w-full max-h-72 object-contain rounded-md border" />}
            </div>

            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Pixels per mV:</label>
                <input
                  type="number"
                  value={pixelsPerMv}
                  onChange={(e) => setPixelsPerMv(e.target.value)}
                  className="w-24 p-2 border rounded-md"
                  min={5}
                  step={1}
                  title="Approximate vertical pixels for 1 mV"
                />
              </div>

              <button type="button" onClick={() => setShowCropUI(true)} className="px-3 py-2 bg-slate-700 text-white rounded-lg" disabled={!imageSrc}>
                Adjust Lead Regions
              </button>

              <button type="button" onClick={convertToPtbxl} className="px-4 py-2 bg-emerald-600 text-white rounded-lg" disabled={loading || !imageSrc}>
                {loading ? "Working..." : "Convert to PTB-XL"}
              </button>

              <button type="button" onClick={runAnalysis} className="px-4 py-2 bg-indigo-600 text-white rounded-lg" disabled={loading || !ptbxlPayload}>
                {loading ? "Running..." : "Run analysis"}
              </button>

              <button type="button" onClick={downloadPdf} className="px-4 py-2 bg-rose-600 text-white rounded-lg" disabled={!analysisResult}>
                Download PDF
              </button>
            </div>

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
          </div>

          {/* ---------------- Sidebar Preview ---------------- */}
          <aside className="p-4 bg-slate-50 rounded-lg">
            <h3 className="text-sm font-medium mb-2">Report Preview</h3>
            {ptbxlPayload ? (
              <div className="text-xs text-slate-700 space-y-2">
                <div><strong>ID:</strong> {ptbxlPayload.record_id}</div>
                <div><strong>Recording:</strong> {ptbxlPayload.metadata.recording_date}</div>
                <div className="mt-2"><strong>Signals (mV):</strong></div>
                <ul className="list-disc pl-4 text-xs mt-1 space-y-1">
                  {ptbxlPayload.leads.map((l) => (
                    <li key={l.name} className="space-y-1">
                      <div>
                        {l.name}: {l.samples ? `${l.samples.length} samples, first: ${l.samples.slice(0,5).map(v => v.toFixed(3)).join(", ")} mV` : "no data"}
                      </div>
                      {Array.isArray(l.samples) && (
                        <svg width="100%" height="40" className="border rounded">
                          <polyline
                            points={l.samples.slice(0, 400).map((v, i) => `${i},${20 - v * pixelsPerMv}`).join(" ")}
                            stroke="currentColor" fill="none" strokeWidth="0.8"
                          />
                        </svg>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-xs text-slate-400">No PTB-XL payload yet. Convert the uploaded image to start.</div>
            )}

            <div className="mt-4">
              <h4 className="text-sm font-medium">Analysis</h4>
              {analysisResult ? (
                <div className="text-xs mt-2">
                  <div><strong>Cardiac axis (frontal):</strong> {analysisResult.cardiac_axis?.frontal ?? "-"}°</div>
                  <div><strong>Rhythm:</strong> {analysisResult.rhythm}</div>
                  <div className="mt-2"><strong>Probabilities:</strong></div>
                  <ul className="list-decimal pl-4 text-xs">
                    {Object.entries(analysisResult.probabilities || {}).map(([k, v]) => (
                      <li key={k}>{k}: {(v * 100).toFixed(1)}%</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-xs text-slate-400">No analysis yet.</div>
              )}
            </div>
          </aside>
        </form>

        <footer className="mt-6 text-center text-xs text-slate-400">
          Prototype — ensure HIPAA-like protections for patient data in production.
        </footer>
      </div>

      {showCropUI && imageSrc && (
        <LeadBoundarySelector imageSrc={imageSrc} onConfirm={handleLeadBoxesConfirm} onCancel={() => setShowCropUI(false)} />
      )}
    </div>
  );
}
