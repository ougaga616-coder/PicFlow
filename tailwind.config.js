/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17201c',
        mist: '#f6f7f4',
        line: '#dde4dc',
        moss: '#3c6b57',
        sea: '#287f8a',
        clay: '#b96945'
      },
      boxShadow: {
        soft: '0 18px 50px rgba(23, 32, 28, 0.08)'
      }
    }
  },
  plugins: []
};
