/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#F4F3EB',
        cream: '#F4F3EB',
        paper: '#FFFDF8',
        sage: {
          DEFAULT: '#61794F',
          dark: '#506541',
          light: '#E7EDDF',
          hover: '#546A44',
        },
        potato: {
          DEFAULT: '#E6B957',
          light: '#FFF6DE',
          dark: '#C89B37',
        },
        ink: {
          main: '#343C2F',
          muted: '#697160',
          sub: '#8E9685',
        },
        line: {
          DEFAULT: '#E4E6D9',
          light: '#F0F2E8',
        },
        alarm: {
          DEFAULT: '#C95D53',
          light: '#FBEBE9',
        },
        course: {
          bg: '#E5EEF5',
          text: '#4F738E',
        },
      },
      borderRadius: {
        'card': '18px',
        'sub': '12px',
        'btn': '14px',
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(97, 121, 79, 0.06)',
        'modal': '0 20px 40px -10px rgba(52, 60, 47, 0.16)',
        'sheet': '0 -10px 30px rgba(52, 60, 47, 0.08)',
      },
      screens: {
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
      },
    },
  },
  plugins: [],
}
