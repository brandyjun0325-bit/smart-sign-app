import React, { useState, useRef, useEffect } from 'react';
import { PenTool, Users, Settings, Trash2, CheckCircle, Clock, User, AlignLeft, RefreshCw, Printer, Loader2, Link, Copy, Check, ShieldCheck, Key, ExternalLink } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, updateDoc } from 'firebase/firestore';

// --- Firebase 초기화 ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'meeting-signature-final';

// 서명 유효성 검사
const isValidSignature = (sig) => typeof sig === 'string' && sig.startsWith('data:image');

// --- 서명 패드 컴포넌트 ---
const SignaturePad = ({ onSignatureChange, onClearRef }) => {
  const canvasRef = useRef(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const drawState = useRef({ isDrawing: false, lastX: 0, lastY: 0, lastTime: 0, lastWidth: 3 });

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
  };

  useEffect(() => {
    initCanvas();
    window.addEventListener('resize', initCanvas);
    return () => window.removeEventListener('resize', initCanvas);
  }, []);

  useEffect(() => {
    if (onClearRef) onClearRef.current = clearCanvas;
  }, [onClearRef]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
    setIsEmpty(true);
    onSignatureChange(null);
  };

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    if (isEmpty) setIsEmpty(false);
    const { x, y } = getCoordinates(e);
    drawState.current = { isDrawing: true, lastX: x, lastY: y, lastTime: Date.now(), lastWidth: 2.5 };
  };

  const draw = (e) => {
    if (!drawState.current.isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const state = drawState.current;
    const currentTime = Date.now();
    const context = canvasRef.current.getContext('2d');
    const distance = Math.sqrt(Math.pow(x - state.lastX, 2) + Math.pow(y - state.lastY, 2));
    const time = currentTime - state.lastTime || 1;
    const velocity = distance / time;
    const targetWidth = Math.max(1.0, Math.min(4.5, 4.5 - velocity * 1.5));
    const lineWidth = state.lastWidth + (targetWidth - state.lastWidth) * 0.2;
    context.lineWidth = lineWidth;
    context.strokeStyle = '#1e3a8a';
    context.beginPath();
    context.moveTo(state.lastX, state.lastY);
    context.lineTo(x, y);
    context.stroke();
    drawState.current = { ...state, lastX: x, lastY: y, lastTime: currentTime, lastWidth: lineWidth };
  };

  const stopDrawing = () => {
    if (drawState.current.isDrawing) {
      drawState.current.isDrawing = false;
      onSignatureChange(canvasRef.current.toDataURL('image/png'));
    }
  };

  return (
    <div className="relative border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-white shadow-inner">
      <canvas ref={canvasRef} className="w-full h-48 sm:h-64 cursor-crosshair touch-none bg-slate-50/20" onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} />
      {isEmpty && <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40"><span className="text-slate-500 font-medium italic text-center px-4">이곳에 성함을 정자로 서명해 주세요</span></div>}
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('signature');
  const [isPrinting, setIsPrinting] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [meetingId, setMeetingId] = useState('MEETING_01');
  const [currentUrlObj, setCurrentUrlObj] = useState(null);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      setCurrentUrlObj(url);
      setIsAdminMode(url.searchParams.get('admin') === 'true');
      setMeetingId(url.searchParams.get('meetId') || 'MEETING_01');
    } catch (e) { console.error(e); }
  }, []);

  const [meetingInfo, setMeetingInfo] = useState({ registerTitle: '회 의 참 석 자 명 부', title: '2026년 상반기 전사 전략 회의', date: '2026-05-09T14:00', organizer: '경영지원팀', description: '2026년 상반기 실적 점검 및 전략 수립을 위한 회의입니다.' });
  const [attendees, setAttendees] = useState(Array.from({ length: 50 }, (_, i) => ({ id: (i + 1).toString(), name: '', signature: null, timestamp: '' })));
  const [participantName, setParticipantName] = useState('');
  const [signatureData, setSignatureData] = useState(null);
  const [status, setStatus] = useState({ show: false, message: '', type: '' });
  const clearCanvasRef = useRef(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) { await signInWithCustomToken(auth, __initial_auth_token); } 
        else { await signInAnonymously(auth); }
      } catch (err) { console.error("Auth Fail", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !meetingId) return;
    const meetingDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'meetings', meetingId);
    const unsubscribe = onSnapshot(meetingDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.info) setMeetingInfo(data.info);
        if (data.attendees) setAttendees(data.attendees);
      } else { setDoc(meetingDocRef, { info: meetingInfo, attendees }); }
      setLoading(false);
    }, (error) => { console.error("Firestore Error", error); });
    return () => unsubscribe();
  }, [user, meetingId]);

  const showStatus = (message, type) => {
    setStatus({ show: true, message: String(message), type });
    setTimeout(() => setStatus({ show: false, message: '', type: '' }), 3000);
  };

  const handleSubmitSignature = async (e) => {
    e.preventDefault();
    if (!participantName.trim()) { showStatus('이름을 입력해주세요.', 'error'); return; }
    if (!signatureData) { showStatus('서명을 완료해주세요.', 'error'); return; }
    if (attendees.some(a => a.name && String(a.name) === participantName.trim())) { showStatus('이미 등록된 이름입니다.', 'error'); return; }
    const emptyIndex = attendees.findIndex(a => !a.name);
    if (emptyIndex === -1) { showStatus('명부가 가득 찼습니다.', 'error'); return; }
    const newAttendees = [...attendees];
    newAttendees[emptyIndex] = { ...newAttendees[emptyIndex], name: participantName.trim(), signature: signatureData, timestamp: new Date().toISOString() };
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'meetings', meetingId), { attendees: newAttendees });
      setParticipantName(''); setSignatureData(null);
      if (clearCanvasRef.current) clearCanvasRef.current();
      showStatus('서명이 성공적으로 제출되었습니다.', 'success');
    } catch (err) { showStatus('저장 오류', 'error'); }
  };

  const handleUpdateInfo = async () => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'meetings', meetingId), { info: meetingInfo });
      showStatus('정보 업데이트 완료', 'success');
    } catch (err) { showStatus('업데이트 실패', 'error'); }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? '-' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!document.getElementById('html2pdf-script')) {
      const script = document.createElement('script');
      script.id = 'html2pdf-script';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      document.body.appendChild(script);
    }
  }, []);

  const handlePrint = async () => {
    if (typeof window === 'undefined' || !window.html2pdf) { showStatus('PDF 모듈 로딩 중...', 'error'); return; }
    setIsPrinting(true);
    const printElement = document.getElementById('print-area-container');
    const opt = { margin: 0, filename: `${meetingInfo.title}_명부.pdf`, image: { type: 'jpeg', quality: 1 }, html2canvas: { scale: 2, useCORS: true, scrollY: 0, scrollX: 0, windowWidth: 794 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    try {
      setTimeout(async () => {
        await window.html2pdf().set(opt).from(printElement).save();
        setIsPrinting(false);
        showStatus('출력 완료', 'success');
      }, 500);
    } catch (err) { setIsPrinting(false); showStatus('PDF 오류', 'error'); }
  };

  const getSafeShareLink = () => {
    if (!currentUrlObj) return '';
    const newUrl = new URL(currentUrlObj.href);
    newUrl.searchParams.delete('admin'); 
    newUrl.searchParams.set('meetId', meetingId);
    return newUrl.toString();
  };

  const copySignerLink = () => {
    const link = getSafeShareLink();
    const inputElement = document.getElementById('share-link-input');
    if (inputElement) {
      inputElement.value = link;
      inputElement.select();
      if (document.execCommand('copy')) { setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); showStatus('복사되었습니다.', 'success'); return; }
    }
    if (navigator.clipboard) { navigator.clipboard.writeText(link).then(() => { setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); showStatus('복사되었습니다.', 'success'); }).catch(() => showStatus('직접 복사해주세요.', 'error')); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>;

  return (
    <>
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-20">
        <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-blue-600 cursor-pointer" onClick={() => setActiveTab('signature')}><PenTool className="w-6 h-6" /><span className="font-bold text-xl tracking-tight italic">SignSync</span></div>
            <div className="flex items-center space-x-2">
              {isAdminMode ? (
                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-sm">
                  <button onClick={() => setActiveTab('signature')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'signature' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>서명 입력</button>
                  <button onClick={() => setActiveTab('admin')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center space-x-1 ${activeTab === 'admin' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Settings className="w-4 h-4" /><span>관리자</span></button>
                </div>
              ) : (
                <button onClick={() => setIsAdminMode(true)} className="flex items-center space-x-2 text-xs font-bold text-slate-400 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-100 transition-colors"><ShieldCheck className="w-3.5 h-3.5 text-green-500" /><span>보안 서명 모드</span></button>
              )}
            </div>
          </div>
        </header>

        {status.show && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50">
            <div className={`px-6 py-3 rounded-full shadow-xl font-bold text-sm flex items-center ${status.type === 'success' ? 'bg-slate-800 text-white' : 'bg-red-50 text-white'}`}>{status.message}</div>
          </div>
        )}

        <main className="max-w-5xl mx-auto px-4 py-8">
          {activeTab === 'signature' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">{String(meetingInfo.title)}</h1>
                <div className="flex flex-wrap items-center text-sm text-slate-600 gap-y-2 gap-x-6 mb-6 pb-6 border-b border-slate-100">
                  <div className="flex items-center font-medium"><Clock className="w-4 h-4 mr-2 text-blue-500" />{formatDate(meetingInfo.date)}</div>
                  <div className="flex items-center font-medium"><User className="w-4 h-4 mr-2 text-blue-500" />주최: {String(meetingInfo.organizer)}</div>
                </div>
                <div className="flex items-start text-slate-700 leading-relaxed"><AlignLeft className="w-5 h-5 mr-3 text-slate-400 mt-0.5 shrink-0" /><p className="whitespace-pre-line">{String(meetingInfo.description)}</p></div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
                <h2 className="text-xl font-semibold text-slate-900 mb-6 flex items-center"><PenTool className="w-5 h-5 mr-2 text-blue-600" />참석 등록 및 서명</h2>
                <form onSubmit={handleSubmitSignature} className="space-y-6">
                  <div><label className="block text-sm font-semibold text-slate-700 mb-2">성명 <span className="text-red-500">*</span></label><input type="text" value={participantName} onChange={(e) => setParticipantName(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-lg" placeholder="성함을 입력하세요" /></div>
                  <div>
                    <div className="flex items-center justify-between mb-2"><label className="block text-sm font-semibold text-slate-700">전자 서명 <span className="text-red-500">*</span></label><button type="button" onClick={() => clearCanvasRef.current?.()} className="text-sm text-blue-600 hover:text-blue-800 flex items-center font-medium"><RefreshCw className="w-3.5 h-3.5 mr-1" />지우기</button></div>
                    <SignaturePad onSignatureChange={setSignatureData} onClearRef={clearCanvasRef} />
                  </div>
                  <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-lg active:scale-[0.98]">서명 제출하기</button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'admin' && isAdminMode && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-xl font-bold text-slate-900 flex items-center mb-6"><Settings className="w-5 h-5 mr-2 text-slate-600" />시스템 설정 및 공유</h2>
                <div className="mb-8 p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <label className="block text-xs font-bold text-blue-800 mb-2 uppercase">참석자 전용 서명 링크</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1 flex items-center bg-white border border-blue-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 shadow-sm"><div className="pl-3 pr-2 py-2 text-blue-400 bg-slate-50 border-r border-slate-200"><Link className="w-4 h-4" /></div><input id="share-link-input" type="text" readOnly value={getSafeShareLink()} className="w-full px-3 py-2.5 text-sm text-slate-600 outline-none font-mono" onClick={(e) => e.target.select()} /></div>
                    <button onClick={copySignerLink} className={`flex-shrink-0 flex items-center justify-center px-6 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm ${isCopied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>{isCopied ? '복사 완료' : '자동 복사'}</button>
                    <button onClick={() => window.open(getSafeShareLink(), '_blank')} className="flex-shrink-0 flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-all shadow-sm"><ExternalLink className="w-4 h-4 mr-1" /> 테스트</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                  <div className="md:col-span-2"><label className="block text-sm font-semibold text-slate-600 mb-2">명부 제목 (출력용)</label><input type="text" value={meetingInfo.registerTitle} onChange={(e) => setMeetingInfo({...meetingInfo, registerTitle: e.target.value})} className="w-full px-4 py-2.5 rounded-lg border border-slate-300 font-bold bg-slate-50" /></div>
                  <div><label className="block text-sm font-semibold text-slate-600 mb-2">회의 제목</label><input type="text" value={meetingInfo.title} onChange={(e) => setMeetingInfo({...meetingInfo, title: e.target.value})} className="w-full px-4 py-2.5 rounded-lg border border-slate-300" /></div>
                  <div><label className="block text-sm font-semibold text-slate-600 mb-2">일시</label><input type="datetime-local" value={meetingInfo.date} onChange={(e) => setMeetingInfo({...meetingInfo, date: e.target.value})} className="w-full px-4 py-2.5 rounded-lg border border-slate-300" /></div>
                  <div className="md:col-span-2 flex justify-between items-center pt-4"><button onClick={() => setIsAdminMode(false)} className="text-slate-500 hover:text-red-500 text-sm flex items-center"><ShieldCheck className="w-4 h-4 mr-1" /> 모드 종료</button><button onClick={handleUpdateInfo} className="bg-slate-800 text-white px-8 py-3 rounded-xl text-sm font-bold">저장</button></div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50"><h2 className="text-xl font-bold text-slate-900 flex items-center"><Users className="w-5 h-5 mr-2 text-slate-600" />참석 현황</h2><button onClick={handlePrint} disabled={isPrinting} className="flex items-center text-sm bg-slate-900 hover:bg-black text-white py-3 px-6 rounded-xl transition-all shadow-xl">{isPrinting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />} PDF 출력 (A4 1장)</button></div>
                <div className="overflow-x-auto max-h-[600px]"><table className="w-full text-left text-sm"><thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold sticky top-0"><tr><th className="px-6 py-4 w-20 text-center">No</th><th className="px-6 py-4">성명</th><th className="px-6 py-4 text-center">서명</th><th className="px-6 py-4 w-20 text-center">제거</th></tr></thead><tbody className="divide-y divide-slate-200">{attendees.map((attendee, index) => (<tr key={attendee.id} className={attendee.name ? "bg-blue-50/30" : "hover:bg-slate-50/50"}><td className="px-6 py-4 text-center text-slate-400 font-mono font-bold">{index + 1}</td><td className="px-6 py-4 font-bold text-slate-900">{attendee.name || "-"}</td><td className="px-6 py-4 flex justify-center">{isValidSignature(attendee.signature) ? (<img src={attendee.signature} className="h-10 object-contain bg-white rounded border border-slate-200 p-1 shadow-sm" alt="서명" />) : <span className="text-slate-200">-</span>}</td><td className="px-6 py-4 text-center">{attendee.name && (<button onClick={async () => { if (!window.confirm("제거?")) return; const filled = attendees.filter(a => a.name && a.id !== attendee.id); const newAttendees = [...filled, ...Array.from({ length: 50 - filled.length }, () => ({ name: '', signature: null, timestamp: '' }))].map((a, idx) => ({ ...a, id: (idx + 1).toString() })); await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'meetings', meetingId), { attendees: newAttendees }); }} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4.5 h-4.5" /></button>)}</td></tr>))}</tbody></table></div>
              </div>
            </div>
          )}
        </main>
      </div>

      <div className="fixed top-[200vh] left-0 z-[-1] pointer-events-none w-[210mm]">
        <div id="print-area-container" className="bg-white text-black font-serif box-border flex flex-col" style={{ width: '210mm', height: '297mm', padding: '15mm 15mm', overflow: 'hidden' }}>
          <div className="text-center w-full mb-[6mm] border-b-2 border-black pb-[3mm] pt-[2mm]"><h1 className="text-[28px] font-extrabold tracking-[0.5em] uppercase">{String(meetingInfo.registerTitle)}</h1></div>
          <table className="w-full mb-[6mm] border-collapse border-2 border-black text-[13px] table-fixed"><tbody><tr className="border-b border-black"><th className="border-r border-black bg-gray-50 px-2 py-1 w-[15%] text-center font-bold h-[8.5mm]">회 의 명</th><td className="px-3 py-1 font-extrabold text-sm truncate h-[8.5mm]">{String(meetingInfo.title)}</td></tr><tr className="border-b border-black"><th className="border-r border-black bg-gray-50 px-2 py-1 text-center font-bold h-[8.5mm]">일 시</th><td className="px-3 py-1 h-[8.5mm]">{formatDate(meetingInfo.date)}</td></tr><tr className="border-b border-black"><th className="border-r border-black bg-gray-50 px-2 py-1 text-center font-bold h-[8.5mm]">주 관</th><td className="px-3 py-1 h-[8.5mm]">{String(meetingInfo.organizer)}</td></tr><tr><th className="border-r border-black bg-gray-50 px-2 py-1 text-center font-bold h-[12mm]">회의 내용</th><td className="px-3 py-1 text-xs leading-snug h-[12mm]"><div className="h-[9mm] overflow-hidden">{String(meetingInfo.description)}</div></td></tr></tbody></table>
          <div className="flex justify-between items-start w-full">{[0, 25].map((start) => (<table key={start} className="w-[48.5%] border-collapse border-2 border-black text-[12px] text-center table-fixed"><thead><tr className="bg-gray-100 border-b-2 border-black h-[7.5mm]"><th className="border-r border-black w-[15%] font-bold">번호</th><th className="border-r border-black w-[35%] font-bold">성 명</th><th className="w-[50%] font-bold">서 명</th></tr></thead><tbody>{attendees.slice(start, start + 25).map((attendee, index) => (<tr key={attendee.id} className="border-b border-black last:border-0 h-[7.5mm]"><td className="border-r border-black font-mono">{index + start + 1}</td><td className="border-r border-black font-bold text-[13px] overflow-hidden whitespace-nowrap">{attendee.name || ""}</td><td className="p-0 relative overflow-hidden">{isValidSignature(attendee.signature) && (<div className="absolute inset-0 flex items-center justify-center p-0.5"><img src={attendee.signature} className="max-h-[6.5mm] max-w-[90%] object-contain" alt="" /></div>)}</td></tr>))}</tbody></table>))}</div>
          <div className="mt-auto pt-2 border-t border-gray-200 text-right w-full text-[10px] text-gray-400 italic">※ 본 문서는 SignSync 시스템에서 생성되었습니다.</div>
        </div>
      </div>
    </>
  );
}