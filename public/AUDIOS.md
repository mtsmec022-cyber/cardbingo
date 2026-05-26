Coloque os audios dos numeros em `public/audios`.

As vozes brasileiras completas ficam em:
- `public/voices/3` - voz masculina com numeros e rimas
- `public/voices/8` - voz masculina apenas com numeros

A tela de configuracoes alterna entre essas vozes. O app procura primeiro em
`public/voices/{voz}/{75|90}/{numero}.mp3`; se nao encontrar, usa os nomes
antigos de `public/audios` e depois o sintetizador do navegador.

Nomes aceitos por numero:
- `1.mp3`, `01.mp3`, `n1.mp3`, `n01.mp3`
- `numero-1.mp3`, `numero_1.mp3`
- `bola-1.mp3`, `bola_1.mp3`

Extensoes aceitas: `.mp3`, `.wav`, `.ogg`, `.m4a`.

Coloque os efeitos em `public/assets/sfx`.

SFX usados pelo app:
- `countdown-start`
- `countdown-tick`
- `started`
- `ball-reveal`
- `bingo`

Exemplo: `public/assets/sfx/ball-reveal.mp3`.

Se esses SFX nao existirem, o app gera um efeito curto por Web Audio para:
- inicio da contagem
- cada segundo da contagem
- revelacao da bola
