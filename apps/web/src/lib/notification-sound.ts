/**
 * Notification sound for new messages.
 * Uses Web Audio API for a built-in two-tone beep (no external file required).
 * To use your own sound: place a file in public/sounds/ (e.g. notification.mp3)
 * and pass { url: "/sounds/notification.mp3" } to playNotificationSound().
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioContext;
}

/**
 * Play a short two-tone beep using Web Audio API (no external file).
 */
function playBeep(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(1100, now + 0.08);
  osc.frequency.setValueAtTime(880, now + 0.16);
  osc.type = "sine";

  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

  osc.start(now);
  osc.stop(now + 0.22);
}

/**
 * Play the notification sound.
 * - By default plays a built-in two-tone beep (no assets required).
 * - Pass options.url to use your own file (e.g. "/sounds/notification.mp3"); falls back to beep on error.
 */
export function playNotificationSound(options?: { url?: string }): void {
  if (options?.url) {
    const audio = new Audio(options.url);
    audio.volume = 0.6;
    audio.play().catch(() => playBeep());
    audio.onerror = () => playBeep();
    return;
  }
  playBeep();
}
