/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './bingo_webos_master.tsx'],
  theme: {
    extend: {
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'zoom-in-95': {
          from: { opacity: '0', transform: 'scale(.95)' },
          to: { opacity: '1', transform: 'scale(1)' }
        },
        'slide-in-from-bottom': {
          from: { opacity: '0', transform: 'translateY(2rem)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'slide-in-from-right': {
          from: { opacity: '0', transform: 'translateX(2rem)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in .5s ease-out both',
        'zoom-in-95': 'zoom-in-95 .5s ease-out both',
        'slide-in-from-bottom': 'slide-in-from-bottom .3s ease-out both',
        'slide-in-from-right': 'slide-in-from-right .3s ease-out both'
      }
    }
  },
  plugins: []
};
