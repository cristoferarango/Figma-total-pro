// Mantiene vivo el puente mientras no haya un cliente MCP hablándole.
//
// El servidor cierra al recibir `stdin end`, y un proceso lanzado en segundo
// plano recibe ese cierre de inmediato. Este envoltorio abre un pipe y lo
// mantiene abierto, de modo que el plugin de Figma pueda conectarse y quedar
// a la espera de consultas.
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: process.cwd(),
  stdio: ["pipe", "ignore", "pipe"],
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("exit", (code, signal) => {
  console.error(`[keepalive] bridge exited code=${code} signal=${signal}`);
  process.exit(code ?? 0);
});

// El pipe se deja abierto a propósito.
setInterval(() => {}, 1 << 30);
