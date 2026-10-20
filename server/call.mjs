// Cliente mínimo para consultar el puente de Figma por stdio.
//
// El servidor del puente se comunica por stdio (es un servidor MCP), así que
// no se puede llamar por HTTP. Este script lo arranca, invoca una herramienta
// y vuelca la respuesta en JSON.
//
// Uso:
//   node call.mjs list_files
//   node call.mjs get_node '{"nodeIds":["5:735"]}'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const toolName = process.argv[2];
if (!toolName) {
  console.error("Falta el nombre de la herramienta");
  process.exit(2);
}
const toolArgs = process.argv[3] ? JSON.parse(process.argv[3]) : {};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  stderr: "inherit",
});

const client = new Client(
  { name: "neox-audit", version: "1.0.0" },
  { capabilities: {} }
);

try {
  await client.connect(transport);
  const result = await client.callTool({ name: toolName, arguments: toolArgs });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("ERROR:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
