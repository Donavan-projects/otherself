// Visuel abstrait du recruteur IA fictif (sans visage) : couronne de barres qui suit sa voix. Même dessin en direct
// (page recruteur, analyseur de sa voix) et dans le rendu après coup d'une prise (page render, analyseur hors temps
// réel sur la voix enregistrée). Canvas 1280×720.

import script from '@/recruteur/entretien.json';

export const RECRUITER_WIDTH = 1280;
export const RECRUITER_HEIGHT = 720;
/** Analyseur de la voix : taille de la FFT (bins = moitié), lissage par défaut de Web Audio. */
export const RECRUITER_FFT = 1024;

/** bins : getByteFrequencyData de l'analyseur de la voix ; now : horloge (ms) de la rotation lente. */
export function drawRecruiterFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, bins: Uint8Array, speaking: boolean, now: number) {
  const width = RECRUITER_WIDTH;
  const height = RECRUITER_HEIGHT;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0b1222');
  gradient.addColorStop(1, '#1a1433');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2 - 20;
  const bars = 72;
  const base = 150 + 6 * Math.sin(now / 900);
  ctx.save();
  ctx.translate(cx, cy);
  // Couronne de barres qui tourne lentement ; chaque barre suit une bande de fréquences de la voix.
  ctx.rotate(now / 6000);
  for (let i = 0; i < bars; i += 1) {
    const value = (bins[Math.floor((i / bars) * bins.length * 0.45)] ?? 0) / 255;
    ctx.rotate((Math.PI * 2) / bars);
    ctx.fillStyle = `hsla(${200 + value * 80}, 85%, ${55 + value * 20}%, ${0.55 + value * 0.45})`;
    ctx.fillRect(base, -3, 8 + value * 120, 6);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, base - 18, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(140, 170, 255, 0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#e6e8ee';
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('AI Recruiter', cx, cy + 14);
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillStyle = '#9fb0d8';
  ctx.fillText(speaking ? 'speaking' : 'listening', cx, cy + 56);
  ctx.textAlign = 'left';
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.fillStyle = '#e6e8ee';
  ctx.fillText(script.name, 40, 64);
  ctx.font = '400 22px system-ui, sans-serif';
  ctx.fillStyle = '#9aa3b2';
  ctx.fillText(`AI Recruiter · ${script.role} interview`, 40, 98);
  ctx.textAlign = 'center';
  ctx.font = '500 22px system-ui, sans-serif';
  ctx.fillStyle = '#c9d2e8';
  ctx.fillText('This interviewer is an AI. Fictional, for demonstration only.', cx, height - 40);
}
