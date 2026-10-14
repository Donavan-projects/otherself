// Logs préfixés par module et horodatés, pour mesurer la latence du pipeline.

export type Logger = (message: string) => void;

function clock() {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

export function createLogger(module: string, sink?: (line: string) => void): Logger {
  return (message) => {
    const line = `[${module}] ${clock()} (+${Math.round(performance.now())} ms) ${message}`;
    console.log(line);
    sink?.(line);
  };
}
