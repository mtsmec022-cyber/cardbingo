import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import QRCode from 'qrcode';
import { Play, Pause, Volume2, Trophy, Sparkles, Settings, PlayCircle, Grid, ArrowLeft, Clock, Hash, Smartphone, QrCode, RefreshCw, Users } from 'lucide-react';
import MobileCardClient from './src/mobile/MobileCardClient';

// Configurações e Estruturas de Jogo
const GAME_TYPES = {
  BINGO_75: {
    id: '75',
    name: 'Clássico (75 Bolas)',
    total: 75,
    desc: 'O tradicional jogo B-I-N-G-O.',
    layout: [
      { letter: 'B', min: 1, max: 15, bg: 'bg-cyan-800', activeBg: 'bg-cyan-500', text: 'text-cyan-400' },
      { letter: 'I', min: 16, max: 30, bg: 'bg-rose-800', activeBg: 'bg-rose-500', text: 'text-rose-400' },
      { letter: 'N', min: 31, max: 45, bg: 'bg-fuchsia-800', activeBg: 'bg-fuchsia-500', text: 'text-fuchsia-400' },
      { letter: 'G', min: 46, max: 60, bg: 'bg-emerald-800', activeBg: 'bg-emerald-500', text: 'text-emerald-400' },
      { letter: 'O', min: 61, max: 75, bg: 'bg-amber-700', activeBg: 'bg-amber-500', text: 'text-amber-400' },
    ]
  },
  BINGO_90: {
    id: '90',
    name: 'Europeu (90 Bolas)',
    total: 90,
    desc: 'Versão com 90 números em 9 dezenas.',
    // Para 90 bolas, dividimos em dezenas (1-10, 11-20...)
    layout: Array.from({ length: 9 }, (_, i) => ({
      letter: `${i}X`, // Apenas um rótulo visual (0s, 10s, 20s...)
      min: i * 10 + 1,
      max: (i + 1) * 10,
      bg: 'bg-slate-800',
      activeBg: 'bg-indigo-500',
      text: 'text-slate-400'
    }))
  }
};

const PATTERNS_75 = [
  { id: 0, name: 'CARTELA CHEIA', activeCells: Array.from({ length: 25 }, (_, i) => i), desc: 'Preencher todos os 24 números' },
  { id: 1, name: 'OS QUATRO CANTOS', activeCells: [0, 4, 20, 24], desc: 'Apenas as pontas da cartela' },
  { id: 2, name: 'LINHA HORIZONTAL', activeCells: [10, 11, 12, 13, 14], desc: 'Qualquer linha reta completa' },
];

const PATTERNS_90 = [
  { id: 0, name: 'CARTÃO COMPLETO', desc: 'Preencher os 15 números do bilhete' },
  { id: 1, name: 'DUAS LINHAS', desc: 'Preencher duas linhas no mesmo bilhete' },
  { id: 2, name: 'LINHA (QUINA)', desc: 'Preencher 5 números na mesma linha' },
];

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a'];
const AUDIO_TIMEOUT_MS = 7000;
const DRAW_MAX_TICKS = 10;
const DRAW_TICK_MS = 45;
const VOICE_OPTIONS = [
  { id: 3, label: 'Masculina', desc: 'Números e rimas' },
  { id: 8, label: 'Masculina #2', desc: 'Apenas números' },
];

const generateRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const isValidRoomCode = (value: string) => /^[A-Z0-9]{6}$/.test(value);

const minimumBallsForPattern = (gameType: string, patternIndex: number) => {
  if (gameType === '90') return patternIndex === 2 ? 5 : patternIndex === 1 ? 10 : 15;
  return patternIndex === 1 ? 4 : patternIndex === 2 ? 5 : 24;
};

const isFreeOrDrawn = (num: number, drawnSet: Set<number>) => num === 0 || drawnSet.has(num);

const validateCardBingo75 = (card: number[], drawnSet: Set<number>, patternIndex: number) => {
  if (!Array.isArray(card) || card.length !== 25) return false;

  if (patternIndex === 1) {
    return [0, 4, 20, 24].every(index => isFreeOrDrawn(Number(card[index]), drawnSet));
  }

  if (patternIndex === 2) {
    return [0, 1, 2, 3, 4].some(row => {
      const start = row * 5;
      return [0, 1, 2, 3, 4].every(col => isFreeOrDrawn(Number(card[start + col]), drawnSet));
    });
  }

  return card.every(num => isFreeOrDrawn(Number(num), drawnSet));
};

const cardProgress75 = (card: number[], drawnSet: Set<number>, patternIndex: number) => {
  if (!Array.isArray(card) || card.length !== 25) return { missing: 99, matched: 0, needed: 0 };

  const scoreCells = (indexes: number[]) => {
    const missing = indexes.filter(index => !isFreeOrDrawn(Number(card[index]), drawnSet)).length;
    return { missing, matched: indexes.length - missing, needed: indexes.length };
  };

  if (patternIndex === 1) return scoreCells([0, 4, 20, 24]);

  if (patternIndex === 2) {
    return [0, 1, 2, 3, 4]
      .map(row => scoreCells([0, 1, 2, 3, 4].map(col => row * 5 + col)))
      .sort((a, b) => a.missing - b.missing || b.matched - a.matched)[0];
  }

  return scoreCells(Array.from({ length: 25 }, (_, index) => index).filter(index => index !== 12));
};

const numberAudioCandidates = (num: number) => {
  const padded = String(num).padStart(2, '0');
  const names = [String(num), padded, `n${num}`, `n${padded}`, `numero-${num}`, `numero_${num}`, `bola-${num}`, `bola_${num}`];

  return names.flatMap(name => AUDIO_EXTENSIONS.map(ext => `/audios/${name}.${ext}`));
};

const voiceNumberAudioCandidates = (num: number, gameType: string, voiceId: number) => [
  `/voices/${voiceId}/${gameType === '75' ? '75' : '90'}/${num}.mp3`,
];

const voicePhraseAudioCandidates = (phrase: string, voiceId: number) => [
  `/voices/${voiceId}/phrases/${phrase}.mp3`,
];

const sfxAudioCandidates = (name: string) => {
  const underscored = name.split('-').join('_');
  const names = [name, underscored, `sfx-${name}`, `sfx_${underscored}`];

  return names.flatMap(fileName => [
    ...AUDIO_EXTENSIONS.map(ext => `/assets/sfx/${fileName}.${ext}`),
    ...AUDIO_EXTENSIONS.map(ext => `/assets/${fileName}.${ext}`),
  ]);
};

const BingoNumber75Cell = React.memo(function BingoNumber75Cell({ num, activeBg, isDrawn, isAnim }) {
  return (
    <div className={`bingo-board-cell flex items-center justify-center rounded-lg font-bold text-xl transition-transform transition-colors duration-300 ${isDrawn ? `${activeBg} text-white shadow-lg` : isAnim ? 'bg-amber-400 text-black scale-110 z-10' : 'bg-slate-800 text-slate-500'}`}>
      {num}
    </div>
  );
});

const BingoNumber90Cell = React.memo(function BingoNumber90Cell({ num, isDrawn, isAnim }) {
  return (
    <div className={`bingo-board-cell flex items-center justify-center rounded-lg font-bold text-2xl transition-transform transition-colors duration-300 
      ${isDrawn ? `bg-indigo-600 text-white shadow-md border-b-4 border-black/30 scale-100` : isAnim ? 'bg-amber-400 text-black scale-110 z-10' : 'bg-slate-800 text-slate-500 border border-slate-700/50 scale-95'}
    `}>
      {num}
    </div>
  );
});

const BingoCelebrationModal = React.memo(function BingoCelebrationModal({ onVerify, onNewGame, winner }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 animate-in fade-in webos-modal-backdrop">
      <div className="text-center webos-bingo-modal">
        <Trophy className="w-48 h-48 text-amber-500 mx-auto mb-8 drop-shadow-[0_0_30px_rgba(251,191,36,0.5)]" />
        <h1 className="text-[12rem] leading-none font-black text-amber-500 tracking-widest uppercase">BINGO</h1>
        {winner?.name && (
          <div className="mt-8">
            <div className="text-white text-5xl font-black uppercase tracking-widest">Parabéns, {winner.name}</div>
            {winner.cardId && <div className="text-slate-500 text-2xl font-black uppercase tracking-widest mt-3">Cartela {winner.cardId}</div>}
          </div>
        )}
        <div className="mt-12 flex gap-6 justify-center">
          <button onClick={onVerify} className="px-12 py-5 bg-slate-800 text-white rounded-full font-bold text-3xl focus:outline-none focus:ring-8 focus:ring-white transition-all">VERIFICAR</button>
          <button onClick={onNewGame} className="px-12 py-5 bg-amber-600 text-black rounded-full font-black text-3xl focus:outline-none focus:ring-8 focus:ring-white transition-all">NOVO JOGO</button>
        </div>
      </div>
    </div>
  );
});

const BingoValidationOverlay = React.memo(function BingoValidationOverlay({ state }) {
  if (!state) return null;

  const isValidating = state.status === 'checking';
  const isValid = state.status === 'valid';
  const title = isValidating ? 'VALIDANDO' : isValid ? 'BINGO VÁLIDO' : 'BINGO INVÁLIDO';
  const accent = isValidating ? 'text-amber-500' : isValid ? 'text-emerald-400' : 'text-rose-500';
  const ring = isValidating ? 'border-amber-500' : isValid ? 'border-emerald-400' : 'border-rose-500';

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 animate-in fade-in webos-modal-backdrop">
      <div className="webos-bingo-modal text-center bg-slate-950 border border-slate-800 rounded-3xl px-16 py-12 min-w-[680px]">
        <div className={`w-36 h-36 rounded-full border-[10px] ${ring} mx-auto mb-8 flex items-center justify-center ${isValidating ? 'animate-pulse' : ''}`}>
          <Trophy className={`w-20 h-20 ${accent}`} />
        </div>
        <div className={`text-7xl font-black uppercase tracking-widest ${accent}`}>{title}</div>
        <div className="text-slate-400 font-black uppercase tracking-widest mt-6">{state.playerName || 'Jogador'}</div>
        {state.cardId && <div className="text-slate-600 font-black uppercase tracking-widest mt-2">Cartela {state.cardId}</div>}
        {!isValidating && !isValid && <div className="text-white text-2xl font-black uppercase tracking-widest mt-8">Continue jogando</div>}
      </div>
    </div>
  );
});

export default function BingoWebOSMaster() {
  const [currentScreen, setCurrentScreen] = useState('menu');
  
  const [settings, setSettings] = useState({
    soundEnabled: true,
    autoSpeed: 5000,
    gameType: '75', // '75' ou '90'
    voiceId: 3
  });

  const [drawnBalls, setDrawnBalls] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [patternIndex, setPatternIndex] = useState(0);
  const [showBingoCelebration, setShowBingoCelebration] = useState(false);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const [displayNumber, setDisplayNumber] = useState(null);
  const [startCountdown, setStartCountdown] = useState<number | null>(null);
  const [startAnnouncement, setStartAnnouncement] = useState(false);
  const [onlineRoomCode, setOnlineRoomCode] = useState(generateRoomCode);
  const [onlineQrUrl, setOnlineQrUrl] = useState('');
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [onlineConnected, setOnlineConnected] = useState(false);
  const [onlineGameMode, setOnlineGameMode] = useState(false);
  const [validationOverlay, setValidationOverlay] = useState(null);
  const [bingoWinner, setBingoWinner] = useState(null);
  
  const autoPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualDrawButtonRef = useRef<HTMLButtonElement | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const countdownActiveRef = useRef(false);
  const drawInProgressRef = useRef(false);
  const audioQueueRef = useRef(Promise.resolve());
  const audioSourceCacheRef = useRef(new Map<string, string | null>());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const hostSocketRef = useRef<WebSocket | null>(null);
  const bingoClaimHandlerRef = useRef(null);

  const currentGameConfig = settings.gameType === '75' ? GAME_TYPES.BINGO_75 : GAME_TYPES.BINGO_90;
  const currentPatterns = settings.gameType === '75' ? PATTERNS_75 : PATTERNS_90;
  const TOTAL_BALLS = currentGameConfig.total;

  const drawnBallSet = useMemo(() => new Set(drawnBalls), [drawnBalls]);
  const recentBalls = useMemo(() => (
    drawnBalls.length > 0 ? [...drawnBalls].reverse().slice(0, 6) : []
  ), [drawnBalls]);
  const boardRows75 = useMemo(() => (
    GAME_TYPES.BINGO_75.layout.map(row => ({
      ...row,
      numbers: Array.from({ length: 15 }, (_, i) => row.min + i),
    }))
  ), []);
  const boardNumbers90 = useMemo(() => Array.from({ length: 90 }, (_, i) => i + 1), []);
  const onlineRanking = useMemo(() => (
    onlinePlayers
      .map((player) => ({
        ...player,
        progress: cardProgress75(player.card || [], drawnBallSet, patternIndex),
      }))
      .filter(player => player.progress.needed > 0)
      .sort((a, b) => a.progress.missing - b.progress.missing || b.progress.matched - a.progress.matched)
      .slice(0, 4)
  ), [drawnBallSet, onlinePlayers, patternIndex]);
  const onlineReadyCount = useMemo(() => (
    onlinePlayers.filter(player => player.ready).length
  ), [onlinePlayers]);
  const canStartOnlineGame = onlinePlayers.length >= 2 && onlineReadyCount === onlinePlayers.length;
  const mobileCardUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('cartela', 'mobile');
    url.searchParams.set('sala', onlineRoomCode);
    return url.toString();
  }, [onlineRoomCode]);
  const webSocketUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }, []);

  useEffect(() => {
    const focusable = Array.from(document.querySelectorAll('button:not(:disabled)')) as HTMLButtonElement[];
    focusable[0]?.focus();
  }, [currentScreen, settings.gameType, patternIndex, showBingoCelebration]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('cartela') === 'mobile') {
      setCurrentScreen('mobileCard');
    }
  }, []);

  useEffect(() => {
    if (!webSocketUrl || !isValidRoomCode(onlineRoomCode)) return;

    hostSocketRef.current?.close();
    const socket = new WebSocket(webSocketUrl);
    hostSocketRef.current = socket;

    socket.onopen = () => {
      setOnlineConnected(true);
      socket.send(JSON.stringify({ type: 'host-join', room: onlineRoomCode }));
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'room-update' && message.room === onlineRoomCode) {
        setOnlinePlayers(message.players || []);
      }
      if (message.type === 'bingo-claim' && message.room === onlineRoomCode) {
        bingoClaimHandlerRef.current?.(message);
      }
    };

    socket.onclose = () => setOnlineConnected(false);
    socket.onerror = () => setOnlineConnected(false);

    return () => {
      socket.close();
      if (hostSocketRef.current === socket) hostSocketRef.current = null;
    };
  }, [onlineRoomCode, webSocketUrl]);

  useEffect(() => {
    if (!mobileCardUrl) return;

    QRCode.toDataURL(mobileCardUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 420,
      color: {
        dark: '#020617',
        light: '#ffffff',
      },
    }).then(setOnlineQrUrl).catch(() => setOnlineQrUrl(''));
  }, [mobileCardUrl]);

  useEffect(() => {
    if (currentScreen === 'game' && drawnBalls.length > 0 && !isPlaying && !isDrawing && !isVoicePlaying && !showBingoCelebration) {
      manualDrawButtonRef.current?.focus();
    }
  }, [currentScreen, drawnBalls.length, isPlaying, isDrawing, isVoicePlaying, showBingoCelebration]);

  useEffect(() => {
    if (currentScreen === 'game' && drawnBalls.length === 0 && startCountdown === null && !startAnnouncement && !isDrawing) {
      requestAnimationFrame(() => startButtonRef.current?.focus());
    }
  }, [currentScreen, drawnBalls.length, startAnnouncement, startCountdown, isDrawing]);

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
      activeAudioRef.current?.pause();
      countdownActiveRef.current = false;
      drawInProgressRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!settings.soundEnabled) {
      activeAudioRef.current?.pause();
      setIsVoicePlaying(false);
    }
  }, [settings.soundEnabled]);

  useEffect(() => {
    const getFocusableButtons = () => (
      Array.from(document.querySelectorAll('button:not(:disabled)')) as HTMLButtonElement[]
    ).filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const moveFocus = (direction: 'up' | 'down' | 'left' | 'right') => {
      const buttons = getFocusableButtons();
      const active = document.activeElement as HTMLButtonElement | null;
      const current = active && buttons.includes(active) ? active : buttons[0];
      if (!current) return;

      const currentRect = current.getBoundingClientRect();
      const currentCenter = {
        x: currentRect.left + currentRect.width / 2,
        y: currentRect.top + currentRect.height / 2,
      };

      const candidates = buttons
        .filter((button) => button !== current)
        .map((button) => {
          const rect = button.getBoundingClientRect();
          const center = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          const dx = center.x - currentCenter.x;
          const dy = center.y - currentCenter.y;

          if (direction === 'left' && dx >= -8) return null;
          if (direction === 'right' && dx <= 8) return null;
          if (direction === 'up' && dy >= -8) return null;
          if (direction === 'down' && dy <= 8) return null;

          const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
          const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);

          return { button, score: primary + secondary * 2 };
        })
        .filter(Boolean) as { button: HTMLButtonElement; score: number }[];

      candidates.sort((a, b) => a.score - b.score);
      candidates[0]?.button.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const keyCode = event.keyCode;
      const keyMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };

      if (keyMap[event.key]) {
        event.preventDefault();
        moveFocus(keyMap[event.key]);
        return;
      }

      if (event.key === 'Enter' || keyCode === 13) {
        event.preventDefault();
        (document.activeElement as HTMLButtonElement | null)?.click?.();
        return;
      }

      if (event.key === 'Escape' || event.key === 'Backspace' || keyCode === 461 || keyCode === 10009) {
        event.preventDefault();
        if (showBingoCelebration) {
          setShowBingoCelebration(false);
          return;
        }
        if (currentScreen !== 'menu') setCurrentScreen('menu');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentScreen, showBingoCelebration]);

  const getBallInfo = (num) => {
    if (!num) return null;
    return currentGameConfig.layout.find(row => num >= row.min && num <= row.max);
  };

  const publishDrawnBall = useCallback((num: number, totalDrawn: number) => {
    const socket = hostSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !isValidRoomCode(onlineRoomCode)) return;

    const info = getBallInfo(num);
    socket.send(JSON.stringify({
      type: 'host-ball',
      room: onlineRoomCode,
      number: num,
      letter: settings.gameType === '75' ? info?.letter || '' : '',
      totalDrawn,
    }));
  }, [onlineRoomCode, settings.gameType, currentGameConfig.layout]);

  const sendBingoResult = useCallback((playerId: string, valid: boolean) => {
    const socket = hostSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !isValidRoomCode(onlineRoomCode)) return;

    socket.send(JSON.stringify({
      type: 'host-bingo-result',
      room: onlineRoomCode,
      playerId,
      valid,
    }));
  }, [onlineRoomCode]);

  const publishOnlineGameStart = useCallback(() => {
    const socket = hostSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !isValidRoomCode(onlineRoomCode)) return;

    socket.send(JSON.stringify({
      type: 'host-game-start',
      room: onlineRoomCode,
    }));
  }, [onlineRoomCode]);

  const playAudioCandidates = useCallback((cacheKey: string, candidates: string[], volume = 1) => {
    if (!settings.soundEnabled) return Promise.resolve(false);

    const cached = audioSourceCacheRef.current.get(cacheKey);
    const sources = cached === null ? [] : cached ? [cached] : candidates;

    if (sources.length === 0) return Promise.resolve(false);

    const trySource = (index: number): Promise<boolean> => {
      const source = sources[index];
      if (!source) {
        audioSourceCacheRef.current.set(cacheKey, null);
        return Promise.resolve(false);
      }

      return new Promise((resolve) => {
        const audio = new Audio(source);
        let settled = false;
        const timeout = window.setTimeout(() => finish(false), AUDIO_TIMEOUT_MS);

        const cleanup = () => {
          window.clearTimeout(timeout);
          audio.onended = null;
          audio.onerror = null;
        };

        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();

          if (ok) {
            audioSourceCacheRef.current.set(cacheKey, source);
            resolve(true);
            return;
          }

          resolve(trySource(index + 1));
        };

        audio.preload = 'auto';
        audio.volume = volume;
        activeAudioRef.current?.pause();
        activeAudioRef.current = audio;
        audio.onended = () => finish(true);
        audio.onerror = () => finish(false);
        audio.play().catch(() => finish(false));
      });
    };

    return trySource(0);
  }, [settings.soundEnabled]);

  const enqueueAudio = useCallback((task: () => Promise<unknown> | unknown) => {
    audioQueueRef.current = audioQueueRef.current
      .catch(() => undefined)
      .then(() => task())
      .catch(() => undefined);

    return audioQueueRef.current;
  }, []);

  const playSfx = useCallback((name: string, volume = 0.8) => {
    return playAudioCandidates(`sfx:${name}`, sfxAudioCandidates(name), volume);
  }, [playAudioCandidates]);

  const playSyntheticSfx = useCallback((type: 'tick' | 'start' | 'reveal' = 'tick', volume = 0.45) => {
    if (!settings.soundEnabled || typeof window === 'undefined') return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = context;
    if (context.state === 'suspended') context.resume().catch(() => undefined);

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const frequency = type === 'start' ? 880 : type === 'reveal' ? 660 : 520;
    const duration = type === 'start' ? 0.22 : 0.12;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.35, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }, [settings.soundEnabled]);

  const playSfxWithFallback = useCallback(async (name: string, fallbackType: 'tick' | 'start' | 'reveal', volume = 0.8) => {
    const played = await playSfx(name, volume);
    if (!played) playSyntheticSfx(fallbackType, Math.min(volume, 0.5));
    return played;
  }, [playSfx, playSyntheticSfx]);

  const playVoicePhrase = useCallback((phrase: string, volume = 1) => {
    if (!settings.soundEnabled) return Promise.resolve(false);

    return enqueueAudio(async () => {
      setIsVoicePlaying(true);
      activeAudioRef.current?.pause();

      try {
        return await playAudioCandidates(
          `phrase:${settings.voiceId}:${phrase}`,
          voicePhraseAudioCandidates(phrase, settings.voiceId),
          volume
        );
      } finally {
        setIsVoicePlaying(false);
      }
    });
  }, [enqueueAudio, playAudioCandidates, settings.soundEnabled, settings.voiceId]);

  const playBingoResultAudio = useCallback((valid: boolean) => {
    if (!settings.soundEnabled) return;

    enqueueAudio(async () => {
      setIsVoicePlaying(true);
      activeAudioRef.current?.pause();

      try {
        await playAudioCandidates(
          `phrase:${settings.voiceId}:bingo`,
          [
            ...voicePhraseAudioCandidates('bingo', settings.voiceId),
            ...sfxAudioCandidates('bingo'),
          ],
          0.95
        );

        await playAudioCandidates(
          `phrase:${settings.voiceId}:${valid ? 'bingo-ok' : 'bad-bingo1'}`,
          valid
            ? [
                ...voicePhraseAudioCandidates('bingo-ok', settings.voiceId),
                ...voicePhraseAudioCandidates('win-bingo', settings.voiceId),
              ]
            : [
                ...voicePhraseAudioCandidates('bad-bingo1', settings.voiceId),
                ...voicePhraseAudioCandidates('bad-bingo2', settings.voiceId),
              ],
          1
        );
      } finally {
        setIsVoicePlaying(false);
      }
    });
  }, [enqueueAudio, playAudioCandidates, settings.soundEnabled, settings.voiceId]);

  const handleOnlineBingoClaim = useCallback((claim) => {
    setValidationOverlay({
      status: 'checking',
      playerName: claim.playerName || 'Jogador',
      cardId: claim.cardId || '',
    });

    const valid = settings.gameType === '75'
      && drawnBalls.length >= minimumBallsForPattern(settings.gameType, patternIndex)
      && validateCardBingo75(claim.card, drawnBallSet, patternIndex);

    window.setTimeout(() => {
      setValidationOverlay({
        status: valid ? 'valid' : 'invalid',
        playerName: claim.playerName || 'Jogador',
        cardId: claim.cardId || '',
      });

      playBingoResultAudio(valid);
      sendBingoResult(String(claim.playerId || ''), valid);

      if (valid) {
        setIsPlaying(false);
        setBingoWinner({
          name: claim.playerName || 'Jogador',
          cardId: claim.cardId || '',
        });
        window.setTimeout(() => {
          setValidationOverlay(null);
          setShowBingoCelebration(true);
        }, 1800);
      } else {
        window.setTimeout(() => setValidationOverlay(null), 2600);
      }
    }, 900);
  }, [drawnBallSet, drawnBalls.length, patternIndex, playBingoResultAudio, sendBingoResult, settings.gameType]);

  useEffect(() => {
    bingoClaimHandlerRef.current = handleOnlineBingoClaim;
  }, [handleOnlineBingoClaim]);

  const speakBall = useCallback((num, isLastBall = false) => {
    if (!settings.soundEnabled) return;
    const info = getBallInfo(num);
    if (info) {
      enqueueAudio(async () => {
        setIsVoicePlaying(true);
        activeAudioRef.current?.pause();

        try {
          const playedRevealSfx = await playAudioCandidates('sfx:ball-reveal', sfxAudioCandidates('ball-reveal'), 0.55);
          if (!playedRevealSfx) playSyntheticSfx('reveal', 0.35);
          await playAudioCandidates(
            `number:${settings.voiceId}:${settings.gameType}:${num}`,
            [
              ...voiceNumberAudioCandidates(num, settings.gameType, settings.voiceId),
              ...numberAudioCandidates(num),
            ],
            1
          );

          if (isLastBall) {
            await playAudioCandidates(
              `phrase:${settings.voiceId}:end`,
              voicePhraseAudioCandidates('end', settings.voiceId),
              1
            );
          }
        } finally {
          setIsVoicePlaying(false);
        }
      });
    }
  }, [enqueueAudio, playAudioCandidates, playSyntheticSfx, settings.soundEnabled, settings.gameType, settings.voiceId, currentGameConfig.layout]);

  const executeDraw = useCallback(() => {
    if (drawInProgressRef.current || isDrawing || startCountdown !== null || startAnnouncement || drawnBalls.length >= TOTAL_BALLS) return;
    
    drawInProgressRef.current = true;
    setIsDrawing(true);
    
    const availableBalls = Array.from({ length: TOTAL_BALLS }, (_, i) => i + 1).filter(num => !drawnBallSet.has(num));
    const finalBall = availableBalls[Math.floor(Math.random() * availableBalls.length)];
    const isLastBall = availableBalls.length === 1;
    
    let ticks = 0;
    
    const shuffleInterval = setInterval(() => {
      const randomVisual = availableBalls[Math.floor(Math.random() * availableBalls.length)];
      setDisplayNumber(randomVisual);
      ticks++;
      
      if (ticks >= DRAW_MAX_TICKS) {
        clearInterval(shuffleInterval);
        setDisplayNumber(finalBall);
        setDrawnBalls(prev => [...prev, finalBall]);
        publishDrawnBall(finalBall, drawnBalls.length + 1);
        if (isLastBall) setIsPlaying(false);
        speakBall(finalBall, isLastBall);
        setIsDrawing(false);
        drawInProgressRef.current = false;
      }
    }, DRAW_TICK_MS);

  }, [drawnBalls, drawnBallSet, isDrawing, publishDrawnBall, startAnnouncement, startCountdown, TOTAL_BALLS, speakBall]);

  const executeInitialDraw = useCallback(() => {
    if (drawInProgressRef.current || isDrawing || drawnBalls.length >= TOTAL_BALLS) return;
    
    drawInProgressRef.current = true;
    setIsDrawing(true);
    
    const availableBalls = Array.from({ length: TOTAL_BALLS }, (_, i) => i + 1).filter(num => !drawnBallSet.has(num));
    const finalBall = availableBalls[Math.floor(Math.random() * availableBalls.length)];
    const isLastBall = availableBalls.length === 1;
    
    let ticks = 0;
    
    const shuffleInterval = setInterval(() => {
      const randomVisual = availableBalls[Math.floor(Math.random() * availableBalls.length)];
      setDisplayNumber(randomVisual);
      ticks++;
      
      if (ticks >= DRAW_MAX_TICKS) {
        clearInterval(shuffleInterval);
        setDisplayNumber(finalBall);
        setDrawnBalls(prev => [...prev, finalBall]);
        publishDrawnBall(finalBall, drawnBalls.length + 1);
        if (isLastBall) setIsPlaying(false);
        speakBall(finalBall, isLastBall);
        setIsDrawing(false);
        drawInProgressRef.current = false;
      }
    }, DRAW_TICK_MS);

  }, [drawnBalls.length, drawnBallSet, isDrawing, publishDrawnBall, TOTAL_BALLS, speakBall]);

  const beginStartCountdown = useCallback(() => {
    if (countdownActiveRef.current || startCountdown !== null || startAnnouncement || drawnBalls.length > 0 || isDrawing) return;

    countdownActiveRef.current = true;
    setIsPlaying(false);
    setStartCountdown(5);
    playSfxWithFallback('countdown-start', 'start', 0.75);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    countdownTimerRef.current = setInterval(() => {
      setStartCountdown((current) => {
        if (current === null) return null;

        if (current <= 1) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          setStartAnnouncement(true);
          const startPhrase = playVoicePhrase('start', 1);
          const minimumAnnouncementTime = new Promise(resolve => {
            announcementTimerRef.current = setTimeout(resolve, 2000);
          });

          Promise.all([startPhrase, minimumAnnouncementTime]).finally(() => {
            setStartAnnouncement(false);
            countdownActiveRef.current = false;
            requestAnimationFrame(() => executeInitialDraw());
          });
          return null;
        }

        playSfxWithFallback('countdown-tick', 'tick', 0.6);
        return current - 1;
      });
    }, 1000);
  }, [drawnBalls.length, executeInitialDraw, isDrawing, playSfxWithFallback, playVoicePhrase, startAnnouncement, startCountdown]);

  useEffect(() => {
    if (isPlaying && !isDrawing && !isVoicePlaying && drawnBalls.length < TOTAL_BALLS) {
      autoPlayTimerRef.current = setTimeout(() => {
        executeDraw();
      }, settings.autoSpeed);
    }
    return () => clearTimeout(autoPlayTimerRef.current);
  }, [isPlaying, isDrawing, isVoicePlaying, drawnBalls.length, TOTAL_BALLS, settings.autoSpeed, executeDraw]);

  const toggleAutoPlay = () => setIsPlaying(!isPlaying);

  // Mudar tipo de jogo reinicia tudo
  const handleGameTypeChange = (type) => {
    if (drawnBalls.length > 0) {
      if (!window.confirm("Mudar o tipo de jogo irá reiniciar o sorteio atual. Continuar?")) return;
    }
    setSettings(s => ({ ...s, gameType: type }));
    setDrawnBalls([]);
    setDisplayNumber(null);
    setIsVoicePlaying(false);
    setStartCountdown(null);
    setStartAnnouncement(false);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
    activeAudioRef.current?.pause();
    countdownActiveRef.current = false;
    drawInProgressRef.current = false;
    setPatternIndex(0);
  };

  const handleBingo = () => {
    setIsPlaying(false);
    setBingoWinner(null);
    setShowBingoCelebration(true);
    enqueueAudio(async () => {
      setIsVoicePlaying(true);
      activeAudioRef.current?.pause();

      try {
        await playAudioCandidates(
          `phrase:${settings.voiceId}:bingo`,
          [
            ...voicePhraseAudioCandidates('bingo', settings.voiceId),
            ...sfxAudioCandidates('bingo'),
          ],
          0.95
        );
      } finally {
        setIsVoicePlaying(false);
      }
    });
  };

  const handleVerifyBingo = useCallback(() => {
    setShowBingoCelebration(false);
  }, []);

  const handleNewGameFromBingo = useCallback(() => {
    activeAudioRef.current?.pause();
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
    countdownActiveRef.current = false;
    drawInProgressRef.current = false;
    setDrawnBalls([]);
    setDisplayNumber(null);
    setIsPlaying(false);
    setIsDrawing(false);
    setIsVoicePlaying(false);
    setStartCountdown(null);
    setStartAnnouncement(false);
    setShowBingoCelebration(false);
    setBingoWinner(null);
    setCurrentScreen('menu');
  }, []);

  const renewOnlineRoom = useCallback(() => {
    hostSocketRef.current?.close();
    setOnlinePlayers([]);
    setOnlineRoomCode(generateRoomCode());
  }, []);

  // ==========================================
  // RENDERIZADORES DE ECRÃ
  // ==========================================

  const renderMenu = () => (
    <div className="flex flex-col items-center justify-center h-full animate-in fade-in duration-500">
      <div className="flex flex-col items-center gap-2 mb-12">
        <div className="flex items-center gap-4 animate-pulse">
           <Sparkles className="text-amber-500 w-12 h-12" />
           <h1 className="text-7xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-amber-200 to-amber-600 uppercase drop-shadow-2xl">
             BINGO HOUSE
           </h1>
           <Sparkles className="text-amber-500 w-12 h-12" />
        </div>
        <div className="bg-slate-800 text-slate-300 px-6 py-2 rounded-full font-bold uppercase tracking-widest border border-slate-700">
          Modo Ativo: {currentGameConfig.name}
        </div>
      </div>

      <div className="flex gap-6 w-full max-w-5xl">
        {/* Lado Esquerdo: Acões de Jogo */}
        <div className="flex-1 flex flex-col gap-6">
          <button 
            onClick={() => { setOnlineGameMode(false); setCurrentScreen('game'); }}
            className="group flex-1 flex flex-col items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-black p-8 rounded-3xl font-black text-3xl uppercase tracking-widest focus:outline-none focus:ring-8 focus:ring-white focus:scale-105 transition-all shadow-[0_0_40px_rgba(217,119,6,0.3)]"
          >
            <PlayCircle className="w-16 h-16 group-focus:animate-bounce" />
            {drawnBalls.length > 0 ? 'Retomar Sorteio' : 'Iniciar Sorteio'}
          </button>
          
          <button 
            onClick={() => {
              if(drawnBalls.length > 0 && !window.confirm("Apagar jogo atual?")) return;
              if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
              if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
              activeAudioRef.current?.pause();
              countdownActiveRef.current = false;
              drawInProgressRef.current = false;
              setOnlineGameMode(false); setStartCountdown(null); setStartAnnouncement(false); setIsVoicePlaying(false); setDrawnBalls([]); setDisplayNumber(null); setCurrentScreen('game');
            }}
            className="group flex items-center justify-center gap-4 bg-slate-800 hover:bg-slate-700 text-white p-6 rounded-2xl font-bold text-xl uppercase tracking-widest border-2 border-slate-700 focus:outline-none focus:bg-rose-600 focus:border-rose-600 focus:scale-105 transition-all"
          >
            Zerar e Recomeçar
          </button>

          <button 
            onClick={() => setCurrentScreen('onlineCards')}
            className="group flex items-center justify-center gap-4 bg-slate-800 hover:bg-slate-700 text-white p-6 rounded-2xl font-bold text-xl uppercase tracking-widest border-2 border-slate-700 focus:outline-none focus:bg-white focus:text-black focus:border-white focus:scale-105 transition-all"
          >
            <Smartphone className="w-8 h-8" />
            Jogar com Cartelas Online
          </button>
        </div>

        {/* Lado Direito: Configurações Rápidas */}
        <div className="flex-1 grid grid-cols-2 gap-4">
          <button 
            onClick={() => setCurrentScreen('type')}
            className="group flex flex-col items-center justify-center gap-3 bg-slate-800 hover:bg-slate-700 text-slate-300 p-6 rounded-3xl font-bold text-lg uppercase tracking-wider border-2 border-slate-700 focus:outline-none focus:bg-white focus:text-black focus:border-white focus:scale-105 transition-all col-span-2"
          >
            <Hash className="w-10 h-10" />
            Tipo de Jogo: {TOTAL_BALLS} Bolas
          </button>

          <button 
            onClick={() => setCurrentScreen('modes')}
            className="group flex flex-col items-center justify-center gap-3 bg-slate-800 hover:bg-slate-700 text-slate-300 p-6 rounded-3xl font-bold text-sm uppercase tracking-wider border-2 border-slate-700 focus:outline-none focus:bg-white focus:text-black focus:border-white focus:scale-105 transition-all"
          >
            <Grid className="w-8 h-8" />
            Padrão
          </button>
          
          <button 
            onClick={() => setCurrentScreen('settings')}
            className="group flex flex-col items-center justify-center gap-3 bg-slate-800 hover:bg-slate-700 text-slate-300 p-6 rounded-3xl font-bold text-sm uppercase tracking-wider border-2 border-slate-700 focus:outline-none focus:bg-white focus:text-black focus:border-white focus:scale-105 transition-all"
          >
            <Settings className="w-8 h-8" />
            Opções
          </button>
        </div>
      </div>
    </div>
  );

  const renderGameType = () => (
    <div className="flex flex-col h-full p-12 animate-in slide-in-from-bottom duration-300">
      <div className="flex items-center gap-6 mb-12 border-b border-slate-800 pb-6">
        <button onClick={() => setCurrentScreen('menu')} className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 text-white focus:outline-none focus:ring-4 focus:ring-amber-500 transition-all">
          <ArrowLeft size={32} />
        </button>
        <h2 className="text-5xl font-black uppercase tracking-widest text-white">Escolher Tipo de Jogo</h2>
      </div>

      <div className="grid grid-cols-2 gap-8 max-w-4xl mx-auto w-full">
        {Object.values(GAME_TYPES).map((type) => {
          const isSelected = settings.gameType === type.id;
          return (
            <button
              key={type.id}
              onClick={() => { handleGameTypeChange(type.id); setCurrentScreen('menu'); }}
              className={`flex flex-col items-center p-10 rounded-[3rem] transition-all text-center focus:outline-none focus:scale-105 focus:ring-8 focus:ring-white
                ${isSelected ? 'bg-amber-600 border-4 border-amber-400 text-black' : 'bg-slate-900 border-4 border-slate-800 hover:bg-slate-800 text-white'}
              `}
            >
              <div className={`text-8xl font-black mb-4 ${isSelected ? 'text-black' : 'text-slate-600'}`}>
                {type.total}
              </div>
              <h3 className="text-3xl font-black uppercase mb-2">{type.name}</h3>
              <p className={`text-lg font-medium ${isSelected ? 'text-amber-900' : 'text-slate-400'}`}>{type.desc}</p>
            </button>
          )
        })}
      </div>
    </div>
  );

  const renderModes = () => (
    <div className="flex flex-col h-full p-12 animate-in slide-in-from-bottom duration-300">
      <div className="flex items-center gap-6 mb-12 border-b border-slate-800 pb-6">
        <button onClick={() => setCurrentScreen('menu')} className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 text-white focus:outline-none focus:ring-4 focus:ring-amber-500 transition-all">
          <ArrowLeft size={32} />
        </button>
        <div className="flex flex-col">
          <h2 className="text-5xl font-black uppercase tracking-widest text-white">Prémio em Jogo</h2>
          <span className="text-slate-400 uppercase tracking-widest font-bold">Modo: {currentGameConfig.name}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 max-w-6xl mx-auto w-full">
        {currentPatterns.map((pattern, idx) => {
          const isSelected = patternIndex === idx;
          return (
            <button
              key={idx}
              onClick={() => { setPatternIndex(idx); setCurrentScreen('menu'); }}
              className={`flex flex-col items-center justify-center p-8 rounded-3xl transition-all text-center h-full focus:outline-none focus:scale-105 focus:ring-8 focus:ring-white
                ${isSelected ? 'bg-amber-600 border-4 border-amber-400' : 'bg-slate-900 border-4 border-slate-800 hover:bg-slate-800'}
              `}
            >
              <Trophy className={`w-16 h-16 mb-4 ${isSelected ? 'text-black' : 'text-slate-600'}`} />
              <h3 className={`text-2xl font-black uppercase mb-2 ${isSelected ? 'text-black' : 'text-white'}`}>{pattern.name}</h3>
              <p className={`font-medium ${isSelected ? 'text-amber-900' : 'text-slate-500'}`}>{pattern.desc}</p>
            </button>
          )
        })}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="flex flex-col h-full p-12 animate-in slide-in-from-right duration-300">
      <div className="flex items-center gap-6 mb-12 border-b border-slate-800 pb-6">
        <button onClick={() => setCurrentScreen('menu')} className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 text-white focus:outline-none focus:ring-4 focus:ring-amber-500 transition-all">
          <ArrowLeft size={32} />
        </button>
        <h2 className="text-5xl font-black uppercase tracking-widest text-white">Configurações</h2>
      </div>

      <div className="flex flex-col gap-8 max-w-3xl mx-auto w-full">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 flex items-center justify-between">
          <div>
            <h3 className="text-3xl font-bold text-white mb-2 flex items-center gap-3"><Volume2 className="text-amber-500"/> Locução Automática</h3>
          </div>
          <button 
            onClick={() => setSettings(s => ({ ...s, soundEnabled: !s.soundEnabled }))}
            className={`w-32 h-16 rounded-full p-2 transition-colors duration-300 focus:outline-none focus:ring-4 focus:ring-white flex items-center ${settings.soundEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
          >
            <div className={`w-12 h-12 bg-white rounded-full shadow-md transform transition-transform duration-300 ${settings.soundEnabled ? 'translate-x-16' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8">
          <h3 className="text-3xl font-bold text-white mb-6 flex items-center gap-3"><Volume2 className="text-amber-500"/> Voz Brasileira</h3>
          <div className="grid grid-cols-2 gap-4">
            {VOICE_OPTIONS.map(voice => {
              const isSelected = settings.voiceId === voice.id;
              return (
                <button
                  key={voice.id}
                  onClick={() => setSettings(s => ({ ...s, voiceId: voice.id }))}
                  className={`p-6 rounded-2xl flex flex-col items-start justify-center gap-2 font-bold text-xl text-left transition-all focus:outline-none focus:scale-105 focus:ring-4 focus:ring-white
                    ${isSelected ? 'bg-amber-600 text-black border-2 border-amber-400' : 'bg-slate-800 text-slate-300 border-2 border-slate-700 hover:bg-slate-700'}
                  `}
                >
                  <span>{voice.label}</span>
                  <span className={`text-sm font-semibold ${isSelected ? 'text-amber-950' : 'text-slate-500'}`}>{voice.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8">
          <h3 className="text-3xl font-bold text-white mb-6 flex items-center gap-3"><Clock className="text-amber-500"/> Velocidade (Sorteio Automático)</h3>
          <div className="flex gap-4">
            {[
              { label: 'Lento (7s)', value: 7000 },
              { label: 'Normal (5s)', value: 5000 },
              { label: 'Rápido (3s)', value: 3000 },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setSettings(s => ({ ...s, autoSpeed: opt.value }))}
                className={`flex-1 p-6 rounded-2xl flex flex-col items-center gap-3 font-bold text-xl transition-all focus:outline-none focus:scale-105 focus:ring-4 focus:ring-white
                  ${settings.autoSpeed === opt.value ? 'bg-amber-600 text-black border-2 border-amber-400' : 'bg-slate-800 text-slate-300 border-2 border-slate-700 hover:bg-slate-700'}
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderOnlineCards = () => (
    <div className="flex flex-col h-full p-12 animate-in slide-in-from-right duration-300">
      <div className="flex items-center gap-6 mb-10 border-b border-slate-800 pb-6">
        <button onClick={() => setCurrentScreen('menu')} className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 text-white focus:outline-none focus:ring-4 focus:ring-amber-500 transition-all">
          <ArrowLeft size={32} />
        </button>
        <div className="flex flex-col">
          <h2 className="text-5xl font-black uppercase tracking-widest text-white">Cartelas Online</h2>
          <span className="text-slate-400 uppercase tracking-widest font-bold">Sala {onlineRoomCode}</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_420px] gap-10 flex-1 min-h-0">
        <div className="flex flex-col gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8">
            <div className="flex items-center gap-4 mb-6">
              <Users className="w-12 h-12 text-amber-500" />
              <div>
                <h3 className="text-3xl font-black text-white uppercase tracking-widest">Modo Mobile</h3>
                <p className="text-slate-400 text-xl font-semibold">Jogadores entram pelo QR e usam cartelas no celular.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-black/40 border border-slate-800 rounded-2xl p-6">
                <div className="text-slate-500 uppercase font-black tracking-widest text-sm mb-2">Sala</div>
                <div className="text-5xl font-black text-amber-500 tracking-widest">{onlineRoomCode}</div>
                <div className={`text-sm font-black uppercase tracking-widest mt-3 ${onlineConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {onlineConnected ? 'Online' : 'Conectando'}
                </div>
              </div>
              <button onClick={renewOnlineRoom} className="bg-slate-800 hover:bg-slate-700 text-white rounded-2xl border-2 border-slate-700 font-black text-xl uppercase tracking-widest flex items-center justify-center gap-3 focus:outline-none focus:ring-4 focus:ring-white transition-all">
                <RefreshCw className="w-7 h-7" />
                Nova Sala
              </button>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-3xl font-black text-white uppercase tracking-widest">Jogadores</h3>
              <div className="text-5xl font-black text-amber-500">{onlinePlayers.length}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 flex-1 overflow-hidden content-start">
              {onlinePlayers.length === 0 && (
                <div className="col-span-2 h-28 bg-black/40 border border-slate-800 rounded-2xl flex items-center justify-center text-slate-500 font-black uppercase tracking-widest">
                  Aguardando jogadores
                </div>
              )}
              {onlinePlayers.slice(0, 8).map((player, index) => (
                <div key={player.id || index} className="h-20 bg-black/40 border border-slate-800 rounded-2xl flex items-center gap-4 px-5">
                  <div className={`w-10 h-10 rounded-full text-white flex items-center justify-center font-black ${player.ready ? 'bg-emerald-600' : 'bg-slate-700'}`}>{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-black uppercase tracking-wider truncate">{player.name || `Jogador ${index + 1}`}</div>
                    <div className={`text-[10px] font-black uppercase tracking-widest ${player.ready ? 'text-emerald-400' : 'text-amber-500'}`}>
                      {player.ready ? `Pronto • ${player.cardId || 'Cartela'}` : 'Escolhendo cartela'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                publishOnlineGameStart();
                setDrawnBalls([]);
                setDisplayNumber(null);
                setIsPlaying(false);
                setBingoWinner(null);
                setOnlineGameMode(true);
                setCurrentScreen('game');
              }}
              disabled={!canStartOnlineGame}
              className="mt-6 h-20 rounded-2xl bg-amber-600 text-black font-black text-3xl uppercase tracking-widest disabled:opacity-40 focus:outline-none focus:ring-8 focus:ring-white transition-all"
            >
              {canStartOnlineGame ? 'Jogar' : onlinePlayers.length < 2 ? 'Aguardando 2 jogadores' : `Prontos ${onlineReadyCount}/${onlinePlayers.length}`}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 flex flex-col items-center justify-between">
          <div className="text-slate-950 text-3xl font-black uppercase tracking-widest">Bingo House</div>
          {onlineQrUrl ? (
            <img src={onlineQrUrl} alt="QR Code da cartela mobile" className="w-full aspect-square object-contain" />
          ) : (
            <div className="w-full aspect-square bg-slate-200 rounded-2xl flex items-center justify-center">
              <QrCode className="w-24 h-24 text-slate-500" />
            </div>
          )}
          <div className="text-slate-700 text-center font-black uppercase tracking-widest">Escaneie para abrir a cartela</div>
        </div>
      </div>
    </div>
  );

  const renderGame = () => {
    const currentInfo = getBallInfo(displayNumber);
    const hasGameStarted = drawnBalls.length > 0;
    const isStartingCountdown = startCountdown !== null;
    const isStartingSequence = isStartingCountdown || startAnnouncement;
    const minimumBingoBalls = minimumBallsForPattern(settings.gameType, patternIndex);
    const canRequestBingo = drawnBalls.length >= minimumBingoBalls;
    const gameControlsDisabled = !hasGameStarted || isStartingSequence || isVoicePlaying;

    return (
      <div className="flex-1 flex flex-col h-full animate-in zoom-in-95 duration-500 relative">
        <BingoValidationOverlay state={validationOverlay} />
        
        {showBingoCelebration && (
          <BingoCelebrationModal winner={bingoWinner} onVerify={handleVerifyBingo} onNewGame={handleNewGameFromBingo} />
        )}

        {/* HEADER: Mantém-se comum a ambos os modos */}
        <header className="flex-none h-[30%] min-h-[220px] flex gap-4 mb-4">
          
          <div className="w-[20%] bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between">
            <button onClick={() => setCurrentScreen('menu')} className="flex items-center justify-center gap-2 bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 font-bold uppercase tracking-wider focus:outline-none focus:ring-4 focus:ring-white py-3 rounded-2xl transition-all">
              <ArrowLeft size={20}/> Menu
            </button>
            {onlineGameMode && (
              <div className="bg-black/50 p-4 rounded-2xl border border-slate-800 flex-1 overflow-hidden">
                <div className="text-xs text-slate-500 uppercase font-black mb-3 tracking-widest">Ranking</div>
                <div className="flex flex-col gap-1.5">
                  {onlineRanking.length === 0 && <div className="text-slate-600 text-xs font-bold">Sem cartelas</div>}
                  {onlineRanking.slice(0, 4).map((player, index) => (
                    <div key={player.id || index} className="bg-slate-900 border border-slate-800 rounded-xl p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-amber-500 font-black text-sm">#{index + 1}</span>
                        <span className="text-white font-black text-xs truncate">{player.cardId || player.id?.slice(0, 6)}</span>
                      </div>
                      <div className="text-slate-500 text-[10px] font-bold uppercase mt-1">
                        {player.progress.missing === 0 ? 'Bingo pronto' : `Faltam ${player.progress.missing}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!onlineGameMode && (
              <div className="text-center bg-black/50 p-4 rounded-2xl border border-slate-800">
                 <div className="text-xs text-slate-500 uppercase font-bold mb-1">Prémio Atual</div>
                 <div className="text-amber-500 font-black leading-tight text-xl">{currentPatterns[patternIndex]?.name}</div>
              </div>
            )}
          </div>

          <div className="flex-1 bg-gradient-to-b from-slate-900 to-black border border-slate-800 rounded-3xl flex items-center justify-between px-10 relative overflow-hidden">
             <div className="flex flex-col z-10 w-1/3">
                 <span className="text-slate-500 font-bold uppercase tracking-widest text-lg">Sorteadas</span>
                 <div className="text-[5rem] leading-none font-black text-white">
                   {drawnBalls.length}<span className="text-slate-700 text-5xl">/{TOTAL_BALLS}</span>
                 </div>
             </div>

             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className={`w-[20vh] h-[20vh] rounded-full flex flex-col items-center justify-center relative z-10 border-[6px] transition-all duration-200
                  ${displayNumber ? `${isDrawing ? 'bg-slate-800 border-amber-500 scale-110' : 'bg-slate-900 border-slate-500 scale-100 shadow-2xl'} ` : 'bg-slate-950 border-slate-800'}
                `}>
                  {displayNumber ? (
                    <div className="text-center translate-y-[-5%]">
                      {settings.gameType === '75' && (
                         <span className={`block text-[2vh] leading-none font-black mb-1 ${isDrawing ? 'text-amber-500' : 'text-slate-400'}`}>{currentInfo?.letter}</span>
                      )}
                      <span className={`block text-[8vh] leading-none font-black tracking-tighter ${isDrawing ? 'text-white blur-[1px]' : 'text-white'}`}>{displayNumber}</span>
                    </div>
                  ) : (
                    <div className="text-slate-700"><Sparkles size={40} className="opacity-20" /></div>
                  )}
                </div>
             </div>

             <div className="flex flex-col z-10 w-1/3 items-end">
                <span className="text-slate-500 font-bold uppercase tracking-widest text-sm mb-2">Anteriores</span>
                <div className="flex gap-2">
                  {recentBalls.slice(0,4).map((num, i) => (
                    <div key={i} className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg border
                      ${i === 0 && !isDrawing ? 'bg-indigo-600 text-white border-white scale-110 shadow-lg' : 'bg-slate-800 text-slate-400 border-slate-700'}
                    `}>{num}</div>
                  ))}
                  {recentBalls.length === 0 && <div className="text-slate-600 text-sm">--</div>}
                </div>
             </div>
          </div>

          <div className="w-[30%] bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between">
            <div className="flex gap-2 h-16 mb-4">
              <button ref={manualDrawButtonRef} onClick={executeDraw} disabled={gameControlsDisabled || isPlaying || isDrawing || drawnBalls.length >= TOTAL_BALLS} className="flex-1 bg-emerald-600 text-white font-black text-xl uppercase rounded-xl focus:outline-none focus:ring-4 focus:ring-white transition-all flex items-center justify-center disabled:opacity-50">+1</button>
              <button onClick={toggleAutoPlay} disabled={gameControlsDisabled || isDrawing || drawnBalls.length >= TOTAL_BALLS} className={`flex-1 flex items-center justify-center gap-2 font-black text-lg uppercase rounded-xl focus:outline-none focus:ring-4 focus:ring-white transition-all disabled:opacity-50 ${isPlaying ? 'bg-amber-500 text-black' : 'bg-slate-800 text-white border-2 border-slate-700'}`}>
                {isPlaying ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}
              </button>
            </div>
            <button onClick={handleBingo} disabled={gameControlsDisabled || !canRequestBingo} className="w-full flex-1 bg-rose-700 text-white font-black text-3xl tracking-[0.2em] rounded-xl focus:outline-none focus:ring-4 focus:ring-white transition-transform active:scale-95 disabled:opacity-30">
              BINGO
            </button>
          </div>
        </header>

        {/* BOTTOM: Grelha Dinâmica */}
        <main className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl p-4 lg:p-6 shadow-2xl relative flex flex-col overflow-hidden">
          {!hasGameStarted && (
             <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col gap-8 items-center justify-center rounded-3xl animate-in fade-in">
                {isStartingCountdown && (
                  <div className="text-center">
                    <div className="text-slate-400 text-2xl font-black uppercase tracking-[0.35em] mb-4">Preparar</div>
                    <div className="text-[12rem] leading-none font-black text-amber-500 tabular-nums drop-shadow-[0_0_35px_rgba(245,158,11,0.55)]">{startCountdown}</div>
                  </div>
                )}
                {startAnnouncement && (
                  <div className="text-center animate-pulse">
                    <div className="text-[7rem] leading-none font-black text-amber-500 uppercase tracking-[0.18em] drop-shadow-[0_0_35px_rgba(245,158,11,0.55)]">Começamos</div>
                  </div>
                )}
                <button ref={startButtonRef} onClick={beginStartCountdown} disabled={isStartingSequence} className="px-10 py-5 bg-amber-500 text-black font-black text-3xl uppercase tracking-widest rounded-full focus:outline-none focus:ring-8 focus:ring-white hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100">
                  {isStartingSequence ? 'Aguarde' : 'Começar'}
                </button>
             </div>
          )}

          {/* LAYOUT 75 BOLAS */}
          {settings.gameType === '75' && (
             <div className="flex-1 flex flex-col gap-2">
                {boardRows75.map((row) => (
                  <div key={row.letter} className="flex items-center gap-3 flex-1">
                    <div className={`w-16 h-full shrink-0 flex items-center justify-center rounded-xl ${row.bg} border-2 border-slate-800`}>
                      <span className={`text-3xl font-black ${row.text}`}>{row.letter}</span>
                    </div>
                    <div className="flex-1 grid grid-cols-15 gap-2 h-full" style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' }}>
                      {row.numbers.map(num => {
                        const isDrawn = drawnBallSet.has(num);
                        const isAnim = displayNumber === num && isDrawing;
                        return (
                          <BingoNumber75Cell key={num} num={num} activeBg={row.activeBg} isDrawn={isDrawn} isAnim={isAnim} />
                        );
                      })}
                    </div>
                  </div>
                ))}
             </div>
          )}

          {/* LAYOUT 90 BOLAS */}
          {settings.gameType === '90' && (
             <div className="flex-1 grid grid-cols-10 gap-2">
               {/* Gerar os 90 números em grid direto */}
               {boardNumbers90.map(num => {
                  const isDrawn = drawnBallSet.has(num);
                  const isAnim = displayNumber === num && isDrawing;
                  return (
                    <BingoNumber90Cell key={num} num={num} isDrawn={isDrawn} isAnim={isAnim} />
                  );
               })}
             </div>
          )}
        </main>
      </div>
    );
  };

  if (currentScreen === 'mobileHome') {
    return <MobileCardClient />;
  }

  if (currentScreen === 'mobileCard') {
    return <MobileCardClient />;
  }

  return (
    <div className="webos-app w-screen h-screen overflow-hidden bg-black text-slate-200 font-sans p-4 lg:p-6 select-none cursor-default flex flex-col">
      {currentScreen === 'menu' && renderMenu()}
      {currentScreen === 'type' && renderGameType()}
      {currentScreen === 'settings' && renderSettings()}
      {currentScreen === 'modes' && renderModes()}
      {currentScreen === 'onlineCards' && renderOnlineCards()}
      {currentScreen === 'game' && renderGame()}
    </div>
  );
}
