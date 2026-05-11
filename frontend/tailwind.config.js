/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#0A0A0F',
        abyss: '#12121A',
        ember: '#FF4500',
        flare: '#FF6B00',
        bone: '#F0F0F0',
        ghost: '#6B6B80',
        danger: '#FF2D2D',
        success: '#00FF88',
        'rare-glow': '#4A9EFF',
        'common-glow': '#8A8A9A',
        'classified-glow': '#FF2D2D',
      },
      fontFamily: {
        ui: ['Rajdhani', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '2px',
        sm: '1px',
        md: '2px',
        lg: '2px',
        xl: '2px',
        '2xl': '2px',
        full: '9999px',
      },
      keyframes: {
        glitch: {
          '0%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(-2px, -2px)' },
          '60%': { transform: 'translate(2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
          '100%': { transform: 'translate(0)' },
        },
        'classified-pulse': {
          '0%, 100%': {
            boxShadow: '0 0 5px #FF2D2D, 0 0 10px #FF2D2D',
          },
          '50%': {
            boxShadow: '0 0 15px #FF2D2D, 0 0 30px #FF2D2D, 0 0 60px rgba(255,45,45,0.4)',
          },
        },
        'legend-glow': {
          '0%, 100%': { textShadow: '0 0 8px #FF4500, 0 0 16px #FF4500' },
          '50%': { textShadow: '0 0 16px #FF4500, 0 0 32px #FF4500, 0 0 60px rgba(255,69,0,0.6)' },
        },
        'slow-drift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        glitch: 'glitch 0.3s ease-in-out',
        'classified-pulse': 'classified-pulse 2s ease-in-out infinite',
        'legend-glow': 'legend-glow 2s ease-in-out infinite',
        'slow-drift': 'slow-drift 8s ease infinite',
      },
    },
  },
  plugins: [],
}
