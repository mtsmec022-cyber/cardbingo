import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const normalizeRoomCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const isValidRoomCode = (value: string) => /^[A-Z0-9]{6}$/.test(value);
const createClientId = () => {
  const random = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return `${timestamp}${random}`.slice(0, 16);
};
const createCardId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const MOBILE_SESSION_KEY = 'bingohouse-mobile-session';

const generateCard75 = () => {
  const ranges = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75],
  ];

  const columns = ranges.map(([min, max]) => {
    const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values.slice(0, 5);
  });

  return Array.from({ length: 25 }, (_, index) => {
    if (index === 12) return 0;
    const row = Math.floor(index / 5);
    const col = index % 5;
    return columns[col][row];
  });
};

const createCardOption = () => ({ id: createCardId(), numbers: generateCard75() });
const buildCardOptionsFromSelected = (selected?: { id?: string; numbers?: number[] } | null) => {
  const base = Array.from({ length: 11 }, createCardOption);
  if (!selected?.id || !Array.isArray(selected.numbers) || selected.numbers.length !== 25) return Array.from({ length: 12 }, createCardOption);
  return [{ id: selected.id, numbers: selected.numbers.map(Number) }, ...base];
};
const readStoredSession = () => {
  try {
    const raw = localStorage.getItem(MOBILE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !isValidRoomCode(normalizeRoomCode(parsed.roomCode || ''))) return null;
    return parsed;
  } catch {
    return null;
  }
};
const isStandaloneApp = () => (
  window.matchMedia?.('(display-mode: standalone)').matches
  || (window.navigator as any).standalone === true
);
const isIosLike = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const RENDER_ONLINE_ORIGIN = import.meta.env.VITE_ONLINE_ORIGIN || 'https://bingohouse-cartela.onrender.com';
const getOnlineOrigin = () => {
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return window.location.origin;
  }
  return RENDER_ONLINE_ORIGIN;
};
const getOnlineWebSocketUrl = () => {
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  return `${RENDER_ONLINE_ORIGIN.replace(/^https:/, 'wss:')}/ws`;
};

export default function MobileCardClient() {
  const storedSessionRef = useRef(readStoredSession());
  const [screen, setScreen] = useState<'home' | 'select' | 'card'>('home');
  const [roomCode, setRoomCode] = useState(storedSessionRef.current?.roomCode || '');
  const [joinCode, setJoinCode] = useState(storedSessionRef.current?.roomCode || '');
  const [playerName, setPlayerName] = useState(localStorage.getItem('bingohouse-player-name') || '');
  const [editingName, setEditingName] = useState(!localStorage.getItem('bingohouse-player-name'));
  const [cardOptions, setCardOptions] = useState(() => buildCardOptionsFromSelected(storedSessionRef.current?.selectedCard));
  const [cardIndex, setCardIndex] = useState(0);
  const [markedNumbers, setMarkedNumbers] = useState(() => new Set(Array.isArray(storedSessionRef.current?.markedNumbers) ? [0, ...storedSessionRef.current.markedNumbers] : [0]));
  const [scannerActive, setScannerActive] = useState(false);
  const [message, setMessage] = useState('');
  const [disconnectModal, setDisconnectModal] = useState<{ title: string; message: string } | null>(null);
  const [currentBall, setCurrentBall] = useState<{ number: number; letter?: string; totalDrawn?: number } | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerSocketRef = useRef<WebSocket | null>(null);
  const suppressDisconnectModalRef = useRef(false);
  const playerIdRef = useRef(localStorage.getItem('bingohouse-player-id') || createClientId());
  const selectedCard = cardOptions[cardIndex];

  const webSocketUrl = useMemo(() => {
    return getOnlineWebSocketUrl();
  }, []);

  const roomStatusUrl = useMemo(() => {
    return `${getOnlineOrigin()}/api/room/`;
  }, []);

  const clearStoredSession = useCallback(() => {
    storedSessionRef.current = null;
    localStorage.removeItem(MOBILE_SESSION_KEY);
  }, []);

  const persistSession = useCallback((overrides?: Partial<{
    roomCode: string;
    playerName: string;
    selectedCard: { id: string; numbers: number[] };
    markedNumbers: number[];
    isReady: boolean;
    gameStarted: boolean;
  }>) => {
    const payload = {
      roomCode,
      playerName,
      selectedCard: {
        id: selectedCard?.id,
        numbers: selectedCard?.numbers,
      },
      markedNumbers: Array.from(markedNumbers).filter((value) => value !== 0),
      isReady,
      gameStarted,
      ...overrides,
    };
    storedSessionRef.current = payload;
    localStorage.setItem(MOBILE_SESSION_KEY, JSON.stringify(payload));
  }, [gameStarted, isReady, markedNumbers, playerName, roomCode, selectedCard]);

  const stopScanner = useCallback(() => {
    if (scannerTimerRef.current) clearInterval(scannerTimerRef.current);
    scannerTimerRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerActive(false);
  }, []);

  const closePlayerSocket = useCallback(() => {
    const socket = playerSocketRef.current;
    playerSocketRef.current = null;
    if (!socket) return;
    suppressDisconnectModalRef.current = true;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.close();
  }, []);

  const returnToHomeWithModal = useCallback((title: string, modalMessage: string) => {
    stopScanner();
    setScreen('home');
    setRoomCode('');
    setCurrentBall(null);
    setMarkedNumbers(new Set([0]));
    setIsReady(false);
    setGameStarted(false);
    setMessage('');
    clearStoredSession();
    setDisconnectModal({ title, message: modalMessage });
  }, [clearStoredSession, stopScanner]);

  const leaveRoom = useCallback(() => {
    closePlayerSocket();
    setScreen('home');
    setMessage('Cartela pausada. Volte usando a mesma sala para retomar.');
  }, [closePlayerSocket]);

  const checkRoomAvailability = useCallback(async (room: string) => {
    const normalized = normalizeRoomCode(room);
    if (!isValidRoomCode(normalized)) {
      return { ok: false, reason: 'Digite um código válido de 6 caracteres.' };
    }

    try {
      const response = await fetch(`${roomStatusUrl}${normalized}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.valid) {
        return { ok: false, reason: 'Código da sala inválido.' };
      }
      if (!data.online) {
        return { ok: false, reason: 'Esta sala está offline no momento. Verifique a TV.' };
      }
      const isRejoin = storedSessionRef.current?.roomCode === normalized;
      if (data.gameActive && !isRejoin) {
        return { ok: false, reason: 'A sala já está jogando. Só quem já entrou pode voltar para a cartela atual.' };
      }
      return { ok: true, room: normalized };
    } catch {
      return { ok: false, reason: 'Não foi possível validar a sala agora.' };
    }
  }, [roomStatusUrl]);

  const enterRoom = useCallback(async (room: string) => {
    const normalized = normalizeRoomCode(room);
    if (!isValidRoomCode(normalized)) {
      setMessage('Digite um código válido de 6 caracteres.');
      return;
    }
    setJoinCode(normalized);

    const cleanName = playerName.trim().slice(0, 24);
    if (!cleanName) {
      setEditingName(true);
      setMessage('Digite seu nome para entrar.');
      return;
    }

    setMessage('Verificando sala...');
    const availability = await checkRoomAvailability(normalized);
    if (!availability.ok) {
      setMessage(availability.reason);
      return;
    }

    const storedSession = storedSessionRef.current;
    const joiningCard = storedSession?.roomCode === normalized && storedSession.selectedCard?.id && Array.isArray(storedSession.selectedCard?.numbers)
      ? { id: String(storedSession.selectedCard.id), numbers: storedSession.selectedCard.numbers.map(Number).slice(0, 25) }
      : selectedCard;

    if (joiningCard?.id && Array.isArray(joiningCard.numbers)) {
      setCardOptions(buildCardOptionsFromSelected(joiningCard));
      setCardIndex(0);
    }

    localStorage.setItem('bingohouse-player-name', cleanName);
    setPlayerName(cleanName);
    setEditingName(false);
    setRoomCode(normalized);
    setDisconnectModal(null);
    setMessage('');
    setCurrentBall(null);
    setMarkedNumbers(new Set(Array.isArray(storedSession?.markedNumbers) ? [0, ...storedSession.markedNumbers] : [0]));
    setIsReady(Boolean(storedSession?.isReady));
    setGameStarted(Boolean(storedSession?.gameStarted));
    setScreen('select');

    closePlayerSocket();
    suppressDisconnectModalRef.current = false;
    const socket = new WebSocket(webSocketUrl);
    playerSocketRef.current = socket;
    socket.onopen = () => {
      setMessage('Conectando à sala...');
      socket.send(JSON.stringify({
        type: 'player-join',
        room: normalized,
        playerId: playerIdRef.current,
        name: cleanName,
        cardId: joiningCard.id,
        card: joiningCard.numbers,
      }));
    };
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'room-unavailable' && data.room === normalized) {
        suppressDisconnectModalRef.current = true;
        playerSocketRef.current = null;
        socket.close();
        returnToHomeWithModal('Sala indisponível', 'A sala existe, mas a TV não está online agora. Verifique o código ou aguarde a TV conectar.');
        return;
      }
      if (data.type === 'player-ack' && data.room === normalized) {
        const player = data.player;
        if (player?.cardId && Array.isArray(player.card) && player.card.length === 25) {
          const restoredCard = { id: String(player.cardId), numbers: player.card.map(Number).slice(0, 25) };
          setCardOptions(buildCardOptionsFromSelected(restoredCard));
          setCardIndex(0);
          persistSession({
            roomCode: normalized,
            playerName: cleanName,
            selectedCard: restoredCard,
            isReady: Boolean(player.ready),
            gameStarted: Boolean(data.gameActive),
          });
        }
        setIsReady(Boolean(player?.ready));
        setGameStarted(Boolean(data.gameActive));
        if (data.currentBall && Number.isFinite(Number(data.currentBall.number))) {
          setCurrentBall({
            number: Number(data.currentBall.number),
            letter: data.currentBall.letter,
            totalDrawn: Number(data.currentBall.totalDrawn || 0),
          });
        }
        setScreen(player?.ready || data.gameActive ? 'card' : 'select');
        setMessage(`Conectado à sala ${normalized}`);
        return;
      }
      if (data.type === 'room-update' && data.room === normalized) {
        if (Number(data.hostCount || 0) <= 0) {
          closePlayerSocket();
          returnToHomeWithModal('Sala desconectada', 'A TV saiu da sessão. Entre novamente quando a sala estiver online.');
          return;
        }
        setMessage(`Conectado à sala ${normalized}`);
      }
      if (data.type === 'ball-update' && data.room === normalized && Number.isFinite(Number(data.number))) {
        setGameStarted(true);
        setCurrentBall({
          number: Number(data.number),
          letter: data.letter,
          totalDrawn: Number(data.totalDrawn || 0),
        });
        persistSession({ gameStarted: true, roomCode: normalized, playerName: cleanName });
      }
      if (data.type === 'bingo-result' && data.room === normalized && data.playerId === playerIdRef.current) {
        setMessage(data.valid ? 'BINGO confirmado!' : 'BINGO inválido. Continue jogando.');
      }
      if (data.type === 'game-start' && data.room === normalized) {
        setGameStarted(true);
        setScreen('card');
        persistSession({ isReady: true, gameStarted: true, roomCode: normalized, playerName: cleanName });
        setMessage('Jogo iniciado. Boa sorte!');
      }
      if (data.type === 'game-reset' && data.room === normalized) {
        setCurrentBall(null);
        setMarkedNumbers(new Set([0]));
        setGameStarted(false);
        setIsReady(false);
        setScreen('select');
        persistSession({ isReady: false, gameStarted: false, markedNumbers: [] });
        setMessage('A TV reiniciou a rodada. Escolha ou confirme sua cartela.');
      }
      if (data.type === 'session-ended' && data.room === normalized) {
        closePlayerSocket();
        returnToHomeWithModal('Sessão encerrada', 'A TV encerrou esta sala. Entre novamente quando uma nova sessão estiver aberta.');
      }
    };
    socket.onerror = () => setMessage('Não foi possível conectar à sala.');
    socket.onclose = () => {
      if (playerSocketRef.current !== socket) return;
      playerSocketRef.current = null;
      if (suppressDisconnectModalRef.current) {
        suppressDisconnectModalRef.current = false;
        return;
      }
      returnToHomeWithModal('Conexão perdida', 'Você foi desconectado da sala. Verifique a TV e entre novamente.');
    };
  }, [checkRoomAvailability, closePlayerSocket, persistSession, playerName, returnToHomeWithModal, selectedCard, webSocketUrl]);

  useEffect(() => {
    localStorage.setItem('bingohouse-player-id', playerIdRef.current);
    const params = new URLSearchParams(window.location.search);
    const room = normalizeRoomCode(params.get('sala') || '');
    if (isValidRoomCode(room)) {
      enterRoom(room);
    } else if (isValidRoomCode(storedSessionRef.current?.roomCode || '')) {
      enterRoom(storedSessionRef.current.roomCode);
    } else if (params.get('sala')) {
      setMessage('Código inválido.');
    }

    return () => {
      stopScanner();
      closePlayerSocket();
    };
  }, []);

  useEffect(() => {
    if (!roomCode || !selectedCard?.id || !Array.isArray(selectedCard?.numbers)) return;
    persistSession();
  }, [gameStarted, isReady, markedNumbers, persistSession, roomCode, selectedCard]);

  useEffect(() => {
    if (isStandaloneApp() || localStorage.getItem('bingohouse-install-dismissed') === '1') return;

    const timer = window.setTimeout(() => setShowInstallModal(true), 900);
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      setShowInstallModal(true);
    };
    const handleInstalled = () => {
      localStorage.setItem('bingohouse-install-dismissed', '1');
      setShowInstallModal(false);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const dismissInstallModal = useCallback(() => {
    localStorage.setItem('bingohouse-install-dismissed', '1');
    setShowInstallModal(false);
  }, []);

  const installMobileApp = useCallback(async () => {
    if (!installPrompt) return;

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') {
      localStorage.setItem('bingohouse-install-dismissed', '1');
    }
    setShowInstallModal(false);
    setInstallPrompt(null);
  }, [installPrompt]);

  const updateSelectedCard = useCallback((nextIndex: number) => {
    if (isReady || gameStarted) return;

    const normalizedIndex = (nextIndex + cardOptions.length) % cardOptions.length;
    const nextCard = cardOptions[normalizedIndex];
    setCardIndex(normalizedIndex);
    setMarkedNumbers(new Set([0]));
    persistSession({
      selectedCard: { id: nextCard.id, numbers: nextCard.numbers },
      markedNumbers: [],
      isReady: false,
    });

    const socket = playerSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN && isValidRoomCode(roomCode)) {
      socket.send(JSON.stringify({
        type: 'player-card-update',
        room: roomCode,
        playerId: playerIdRef.current,
        name: playerName.trim().slice(0, 24),
        cardId: nextCard.id,
        card: nextCard.numbers,
      }));
    }
  }, [cardOptions, gameStarted, isReady, playerName, roomCode]);

  const markReady = useCallback(() => {
    const socket = playerSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !isValidRoomCode(roomCode)) {
      setMessage('Sala desconectada. Entre novamente.');
      return;
    }

    setIsReady(true);
    setMessage('Pronto. Aguardando a TV iniciar.');
    setScreen('card');
    persistSession({
      roomCode,
      playerName: playerName.trim().slice(0, 24),
      selectedCard: { id: selectedCard.id, numbers: selectedCard.numbers },
      isReady: true,
      gameStarted,
    });
    socket.send(JSON.stringify({
      type: 'player-ready',
      room: roomCode,
      playerId: playerIdRef.current,
      name: playerName.trim().slice(0, 24),
      cardId: selectedCard.id,
      card: selectedCard.numbers,
    }));
  }, [gameStarted, persistSession, playerName, roomCode, selectedCard]);

  const callBingo = useCallback(() => {
    const socket = playerSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !isValidRoomCode(roomCode)) {
      setMessage('Sala desconectada. Entre novamente.');
      return;
    }

    setMessage('BINGO enviado para verificação.');
    socket.send(JSON.stringify({
      type: 'bingo-claim',
      room: roomCode,
      playerId: playerIdRef.current,
      name: playerName.trim().slice(0, 24),
      cardId: selectedCard.id,
      card: selectedCard.numbers,
    }));
  }, [playerName, selectedCard, roomCode]);

  const startScanner = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('Câmera indisponível neste dispositivo.');
      return;
    }

    const BarcodeDetectorClass = (window as any).BarcodeDetector;
    if (!BarcodeDetectorClass) {
      setMessage('Leitor QR nativo indisponível. Digite o código da sala.');
      return;
    }

    try {
      setMessage('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });

      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScannerActive(true);

      const detector = new BarcodeDetectorClass({ formats: ['qr_code'] });
      if (scannerTimerRef.current) clearInterval(scannerTimerRef.current);
      scannerTimerRef.current = setInterval(async () => {
        if (!videoRef.current) return;
        const codes = await detector.detect(videoRef.current).catch(() => []);
        const value = codes?.[0]?.rawValue;
        if (!value) return;

        try {
          const url = new URL(value);
          const room = normalizeRoomCode(url.searchParams.get('sala') || '');
          if (!isValidRoomCode(room)) {
            setMessage('QR inválido para esta sala.');
            return;
          }
          stopScanner();
          enterRoom(room);
        } catch {
          setMessage('QR inválido para esta sala.');
        }
      }, 700);
    } catch {
      setMessage('Não foi possível abrir a câmera.');
      stopScanner();
    }
  }, [enterRoom, stopScanner]);

  const toggleNumber = useCallback((num: number) => {
    if (num === 0) return;
    setMarkedNumbers(prev => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }, []);

  const disconnectDialog = disconnectModal ? (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-3xl p-6 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-rose-700 mx-auto mb-5 flex items-center justify-center text-white font-black text-3xl">!</div>
        <div className="text-white text-2xl font-black uppercase tracking-widest">{disconnectModal.title}</div>
        <div className="text-slate-400 font-bold mt-3 leading-relaxed">{disconnectModal.message}</div>
        <button
          onClick={() => setDisconnectModal(null)}
          className="mt-6 h-14 w-full rounded-2xl bg-amber-600 text-black font-black uppercase tracking-widest focus:outline-none focus:ring-4 focus:ring-white"
        >
          Entendi
        </button>
      </div>
    </div>
  ) : null;
  const installDialog = showInstallModal && !isStandaloneApp() ? (
    <div className="fixed inset-0 z-40 bg-black/85 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-3xl p-6 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-amber-600 mx-auto mb-5 flex items-center justify-center">
          <Sparkles className="w-9 h-9 text-black" />
        </div>
        <div className="text-white text-2xl font-black uppercase tracking-widest">Instalar Cartela</div>
        <div className="text-slate-400 font-bold mt-3 leading-relaxed">
          Deixe a cartela do Bingo House na tela inicial para entrar mais rápido nas salas.
        </div>
        {installPrompt ? (
          <button
            onClick={installMobileApp}
            className="mt-6 h-14 w-full rounded-2xl bg-amber-600 text-black font-black uppercase tracking-widest focus:outline-none focus:ring-4 focus:ring-white"
          >
            Instalar
          </button>
        ) : (
          <div className="mt-5 bg-black/40 border border-slate-800 rounded-2xl p-4 text-left">
            <div className="text-slate-500 text-xs font-black uppercase tracking-widest mb-2">Como instalar</div>
            <div className="text-slate-200 font-bold text-sm leading-relaxed">
              {isIosLike()
                ? 'No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.'
                : 'No navegador, abra o menu e toque em Instalar app ou Adicionar à tela inicial.'}
            </div>
          </div>
        )}
        <button
          onClick={dismissInstallModal}
          className="mt-3 h-12 w-full rounded-2xl bg-slate-800 border border-slate-700 text-slate-300 font-black uppercase tracking-widest focus:outline-none focus:ring-4 focus:ring-white"
        >
          Agora não
        </button>
      </div>
    </div>
  ) : null;

  if (screen === 'home') {
    return (
      <div className="mobile-card-app min-h-screen bg-black text-slate-200 font-sans p-4 select-none">
        {installDialog}
        {disconnectDialog}
        <div className="max-w-md mx-auto min-h-screen flex flex-col justify-center gap-5">
          <div className="text-center mb-4">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Sparkles className="w-9 h-9 text-amber-500" />
              <div className="text-4xl font-black text-amber-500 uppercase tracking-widest">Bingo House</div>
            </div>
            <div className="text-slate-400 font-bold uppercase tracking-widest">Cartela Online</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col gap-4">
            {editingName ? (
              <>
                <label className="text-slate-500 text-xs font-black uppercase tracking-widest">Nome do jogador</label>
                <input
                  value={playerName}
                  onChange={(event) => {
                    setPlayerName(event.target.value.slice(0, 24));
                    setMessage('');
                  }}
                  placeholder="SEU NOME"
                  inputMode="text"
                  maxLength={24}
                  className="h-16 rounded-2xl bg-black border-2 border-slate-800 text-white text-center text-2xl font-black tracking-widest uppercase focus:outline-none focus:ring-4 focus:ring-amber-500"
                />
                <button
                  onClick={() => {
                    const cleanName = playerName.trim().slice(0, 24);
                    if (!cleanName) {
                      setMessage('Digite seu nome para continuar.');
                      return;
                    }
                    localStorage.setItem('bingohouse-player-name', cleanName);
                    setPlayerName(cleanName);
                    setEditingName(false);
                    setMessage('');
                  }}
                  className="h-14 rounded-2xl bg-slate-800 border border-slate-700 text-white font-black uppercase tracking-widest focus:outline-none focus:ring-4 focus:ring-white"
                >
                  Salvar Nome
                </button>
              </>
            ) : (
              <div className="bg-black/40 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-slate-500 text-xs font-black uppercase tracking-widest">Jogador</div>
                  <div className="text-white text-xl font-black uppercase tracking-widest truncate">{playerName}</div>
                </div>
                <button
                  onClick={() => setEditingName(true)}
                  className="px-4 h-12 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-xs font-black uppercase tracking-widest focus:outline-none focus:ring-4 focus:ring-white"
                >
                  Alterar
                </button>
              </div>
            )}

            <label className="text-slate-500 text-xs font-black uppercase tracking-widest">Código da sala</label>
            <input
              value={joinCode}
              onChange={(event) => {
                setJoinCode(normalizeRoomCode(event.target.value));
                setMessage('');
              }}
              placeholder="ABC123"
              inputMode="text"
              maxLength={6}
              className="h-16 rounded-2xl bg-black border-2 border-slate-800 text-white text-center text-3xl font-black tracking-[0.35em] uppercase focus:outline-none focus:ring-4 focus:ring-amber-500"
            />
            <button
              onClick={() => enterRoom(joinCode)}
              disabled={!isValidRoomCode(joinCode) || !playerName.trim()}
              className="h-16 rounded-2xl bg-amber-600 text-black font-black uppercase tracking-widest text-xl disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-white"
            >
              Entrar
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={startScanner} disabled={scannerActive} className="h-16 rounded-2xl bg-slate-800 border-2 border-slate-700 text-white font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-white">
              <Camera className="w-6 h-6" />
              Escanear
            </button>
            <button onClick={stopScanner} disabled={!scannerActive} className="h-16 rounded-2xl bg-rose-700 text-white font-black uppercase tracking-widest disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-white">
              Parar
            </button>
          </div>

          <video ref={videoRef} className={`w-full rounded-3xl border border-slate-800 bg-slate-950 ${scannerActive ? 'block' : 'hidden'}`} playsInline muted />
          {message && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center text-slate-300 font-bold">{message}</div>}
        </div>
      </div>
    );
  }

  if (screen === 'select') {
    return (
      <div className="mobile-card-app min-h-screen bg-black text-slate-200 font-sans p-4 select-none">
        {installDialog}
        {disconnectDialog}
        <div className="max-w-md mx-auto min-h-screen flex flex-col gap-4 py-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-3xl font-black text-amber-500 uppercase tracking-widest">Bingo House</div>
              <div className="text-slate-500 font-bold uppercase tracking-widest text-xs">Sala {roomCode}</div>
            </div>
            <button onClick={leaveRoom} className="px-4 h-12 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm font-black uppercase tracking-widest focus:outline-none focus:ring-4 focus:ring-white">
              Sala
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-center">
            <div className="text-slate-500 text-xs font-black uppercase tracking-widest mb-2">Escolha sua cartela</div>
            <div className="text-white text-2xl font-black uppercase tracking-widest">Cartela {selectedCard.id}</div>
            <div className="text-slate-600 text-xs font-black uppercase tracking-widest mt-1">{cardIndex + 1}/{cardOptions.length}</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4">
            <div className="grid grid-cols-5 gap-2 mb-2">
              {['B', 'I', 'N', 'G', 'O'].map(letter => (
                <div key={letter} className="h-12 rounded-xl bg-amber-600 text-black flex items-center justify-center text-2xl font-black">{letter}</div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {selectedCard.numbers.map((num, index) => (
                <div
                  key={`${num}-${index}`}
                  className={`aspect-square rounded-xl border font-black text-xl flex items-center justify-center
                    ${num === 0 ? 'bg-amber-500 text-black border-amber-300' : 'bg-slate-800 text-white border-slate-700'}
                  `}
                >
                  {num === 0 ? 'FREE' : num}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[72px_1fr_72px] gap-3">
            <button
              onClick={() => updateSelectedCard(cardIndex - 1)}
              className="h-16 rounded-2xl bg-slate-800 border border-slate-700 text-white flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-white"
              aria-label="Cartela anterior"
            >
              <ChevronLeft className="w-9 h-9" />
            </button>
            <button
              onClick={markReady}
              className="h-16 rounded-2xl bg-emerald-600 text-white font-black uppercase tracking-widest text-lg focus:outline-none focus:ring-4 focus:ring-white"
            >
              Pronto com esta
            </button>
            <button
              onClick={() => updateSelectedCard(cardIndex + 1)}
              className="h-16 rounded-2xl bg-slate-800 border border-slate-700 text-white flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-white"
              aria-label="Próxima cartela"
            >
              <ChevronRight className="w-9 h-9" />
            </button>
          </div>

          {message && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center text-slate-300 font-bold">{message}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-card-app min-h-screen bg-black text-slate-200 font-sans p-4 select-none">
      {installDialog}
      {disconnectDialog}
      <div className="max-w-md mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between py-2">
          <div>
            <div className="text-3xl font-black text-amber-500 uppercase tracking-widest">Bingo House</div>
            <div className="text-slate-500 font-bold uppercase tracking-widest text-xs">Sala {roomCode}</div>
            <div className="text-slate-600 font-black uppercase tracking-widest text-[10px]">Cartela {selectedCard.id}</div>
          </div>
          <button onClick={leaveRoom} className="px-4 h-12 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm font-black uppercase tracking-widest focus:outline-none focus:ring-4 focus:ring-white">
            Sala
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4">
          <div className="grid grid-cols-5 gap-2 mb-2">
            {['B', 'I', 'N', 'G', 'O'].map(letter => (
              <div key={letter} className="h-12 rounded-xl bg-amber-600 text-black flex items-center justify-center text-2xl font-black">{letter}</div>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-2">
            {selectedCard.numbers.map((num, index) => {
              const marked = markedNumbers.has(num);
              return (
                <button
                  key={`${num}-${index}`}
                  onClick={() => toggleNumber(num)}
                  className={`aspect-square rounded-xl border font-black text-xl focus:outline-none focus:ring-4 focus:ring-white transition-transform active:scale-95
                    ${marked ? 'bg-amber-500 text-black border-amber-300' : 'bg-slate-800 text-white border-slate-700'}
                  `}
                >
                  {num === 0 ? 'FREE' : num}
                </button>
              );
            })}
          </div>
        </div>

        {!gameStarted && (
          <div className="h-16 rounded-2xl bg-emerald-950 border border-emerald-800 text-emerald-300 font-black uppercase tracking-[0.2em] text-sm flex items-center justify-center">
            Pronto. Aguardando início
          </div>
        )}

        <button onClick={callBingo} disabled={!gameStarted} className="h-16 rounded-2xl bg-rose-700 text-white font-black uppercase tracking-[0.2em] text-xl disabled:opacity-30 focus:outline-none focus:ring-4 focus:ring-white">
          BINGO
        </button>
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex items-center justify-center min-h-[148px]">
          {currentBall ? (
            <div className="flex items-center justify-center gap-5">
              <div className="w-28 h-28 rounded-full bg-slate-950 border-[6px] border-amber-500 flex flex-col items-center justify-center shadow-2xl">
                {currentBall.letter && <div className="text-amber-500 text-lg font-black leading-none">{currentBall.letter}</div>}
                <div className="text-white text-5xl font-black leading-none">{currentBall.number}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs font-black uppercase tracking-widest mb-2">Sorteada</div>
                <div className="text-amber-500 text-3xl font-black uppercase tracking-widest">Agora</div>
                {currentBall.totalDrawn ? <div className="text-slate-400 text-sm font-bold mt-1">{currentBall.totalDrawn} bolas</div> : null}
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-slate-500 text-xs font-black uppercase tracking-widest mb-3">Aguardando sorteio</div>
              <div className="w-20 h-20 rounded-full bg-slate-950 border-4 border-slate-800 mx-auto flex items-center justify-center shadow-inner shadow-black/40">
                <svg viewBox="0 0 64 64" aria-hidden="true" className="w-11 h-11 text-slate-500">
                  <circle cx="32" cy="22" r="10" fill="currentColor" opacity="0.95" />
                  <path d="M16 51c0-8.837 7.163-16 16-16s16 7.163 16 16" fill="currentColor" opacity="0.95" />
                </svg>
              </div>
            </div>
          )}
        </div>
        {message && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center text-slate-300 font-bold">{message}</div>}
      </div>
    </div>
  );
}
