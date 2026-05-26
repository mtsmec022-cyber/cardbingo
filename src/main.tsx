import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const MIN_BOOT_LOADING_MS = 10000;

const LOADING_MESSAGES = [
  {
    label: 'Dica de Mestre',
    items: [
      'O Bingo de 75 bolas é o mais tradicional e usa o famoso padrão B-I-N-G-O.',
      'No Bingo de 90 bolas, os números são sorteados em nove dezenas (1 a 90).',
      'Fique atento! O padrão "Quatro Cantos" é um dos mais rápidos de completar.',
      'A cartela cheia é o prêmio máximo e exige que todos os números sejam marcados.',
      'O locutor deve sempre repetir o número sorteado para garantir que todos ouçam.',
      'Em rodadas de 75 bolas, o quadrado central da cartela costuma ser grátis.',
      'Marcar a cartela com atenção é parte da diversão e da estratégia do jogo.',
      'O termo "Quina" refere-se a completar uma linha horizontal com 5 números.',
      'Sempre confira os números marcados antes de gritar BINGO em voz alta.',
      'O ritmo do sorteio deve ser constante para manter a emoção da sala.',
    ],
  },
  {
    label: 'Curiosidade',
    items: [
      'O Bingo moderno tem raízes em uma loteria italiana do século XVI.',
      'O nome "Bingo" surgiu de um erro: um jogador gritou Bingo em vez de Beano.',
      'Existem milhões de combinações possíveis em uma única cartela de Bingo.',
      'O Bingo é conhecido por ajudar na concentração e na memória dos jogadores.',
      'No Reino Unido, o Bingo de 90 bolas é a versão mais popular nos clubes.',
      'Antigamente, usavam-se feijões secos para marcar os números nas cartelas.',
      'O Bingo foi usado para ensinar matemática e história em escolas alemãs.',
      'A maior partida de Bingo do mundo reuniu mais de 70 mil pessoas.',
      'O número 1 no Bingo é carinhosamente chamado de "O começo de tudo".',
      'O número 11 costuma ser chamado de "As pernas de quem joga".',
    ],
  },
  {
    label: 'Regras de Ouro',
    items: [
      'Um Bingo só é válido se a última bola chamada estiver na sua cartela.',
      'Grite BINGO com clareza para que o sorteador pare o globo imediatamente.',
      'Mantenha sua cartela visível para os fiscais durante a conferência.',
      'Prêmios de Linha e Cartela Cheia podem ter valores diferentes na rodada.',
      'Se houver mais de um ganhador, o prêmio geralmente é dividido entre eles.',
      'O sorteador é a autoridade máxima durante a realização do sorteio.',
      'Cartelas rasuradas ou ilegíveis podem ser invalidadas pela mesa.',
      'O silêncio na sala ajuda os jogadores a ouvirem melhor cada número.',
      'A conferência eletrônica agiliza a validação sem tirar a emoção.',
      'Respeite sempre o tempo do locutor entre uma bola e outra.',
    ],
  },
  {
    label: 'Sorteio e Emoção',
    items: [
      'A expectativa da última bola é o momento de maior tensão no Bingo.',
      'O sorteio automático garante imparcialidade e ritmo perfeito ao jogo.',
      'Ver a bola subindo no vídeo traz a mesma emoção do globo físico.',
      'Cores vibrantes na TV ajudam a identificar as pedras de longe.',
      'O histórico de bolas na tela evita dúvidas sobre o que já foi chamado.',
      'Vozes claras e pausadas evitam confusão entre números parecidos.',
      'O Bingo é um jogo de sorte, mas a vibração positiva é garantida.',
      'Reunir a família para um Bingo em casa é criar memórias inesquecíveis.',
      'Cada número sorteado é um passo mais perto da grande vitória.',
      'A alegria de gritar BINGO é o que faz este jogo ser amado no mundo todo.',
    ],
  },
].flatMap((group) => group.items.map((text) => ({ label: group.label, text })));

type LoadingMessage = typeof LOADING_MESSAGES[number];

const shuffleTips = (tips: LoadingMessage[], avoid?: string) => {
  const pool = [...tips];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  if (avoid && pool[0]?.text === avoid && pool.length > 1) {
    [pool[0], pool[1]] = [pool[1], pool[0]];
  }

  return pool;
};

function BootLoadingScreen() {
  const [progress, setProgress] = React.useState(0);
  const activeMessage = React.useMemo(() => {
    const pool = [...LOADING_MESSAGES];
    return pool[Math.floor(Math.random() * pool.length)];
  }, []);

  React.useEffect(() => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;

        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(520, now);
        oscillator.frequency.exponentialRampToValueAtTime(760, now + 0.18);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.035, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.26);
        window.setTimeout(() => context.close().catch(() => undefined), 320);
      }
    } catch {
      undefined;
    }
  }, []);

  React.useEffect(() => {
    const startTime = Date.now();
    const duration = MIN_BOOT_LOADING_MS;

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const currentProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(currentProgress);
      
      if (currentProgress < 100) {
        requestAnimationFrame(updateProgress);
      }
    };

    const progressId = requestAnimationFrame(updateProgress);

    return () => {
      cancelAnimationFrame(progressId);
    };
  }, []);

  return (
    <div className="boot-loading-screen" aria-label="Carregando Bingo House">
      <div className="boot-loading-glow" />
      <div className="boot-loading-content">
        <div className="boot-loading-logo-wrapper">
          <div className="boot-loading-logo">B</div>
        </div>
        
        <div className="boot-loading-card">
          <div className="boot-loading-badge">Bingo House</div>
          <div className="boot-loading-title">Inicializando</div>
          <div className="boot-loading-subtitle">Preparando sua experiência de jogo</div>
          
          <div className="boot-loading-progress-container">
            <div className="boot-loading-progress-bg">
              <div 
                className="boot-loading-progress-fill" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <div className="boot-loading-progress-text">{Math.round(progress)}%</div>
          </div>

          <div className="boot-loading-tip" aria-live="polite">
            <span className="boot-loading-tip-label">{activeMessage.label}</span>
            <span className="boot-loading-tip-text">{activeMessage.text}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const renderApp = async () => {
  const bootStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  root.render(
    <React.StrictMode>
      <BootLoadingScreen />
    </React.StrictMode>
  );

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const params = new URLSearchParams(window.location.search);
  const mobileOnly = import.meta.env.VITE_MOBILE_ONLY === 'true';

  if (mobileOnly || params.get('cartela') === 'mobile') {
    const [{ default: MobileCardClient }] = await Promise.all([
      import('./mobile/MobileCardClient'),
      new Promise((resolve) => {
        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - bootStartedAt;
        const remaining = Math.max(0, MIN_BOOT_LOADING_MS - elapsed);
        window.setTimeout(resolve, remaining);
      }),
    ]);
    root.render(
      <React.StrictMode>
        <MobileCardClient />
      </React.StrictMode>
    );
    return;
  }

  const [{ default: BingoWebOSMaster }] = await Promise.all([
    import('../bingo_webos_master'),
    new Promise((resolve) => {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - bootStartedAt;
      const remaining = Math.max(0, MIN_BOOT_LOADING_MS - elapsed);
      window.setTimeout(resolve, remaining);
    }),
  ]);
  root.render(
    <React.StrictMode>
      <BingoWebOSMaster />
    </React.StrictMode>
  );
};

renderApp();

if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
