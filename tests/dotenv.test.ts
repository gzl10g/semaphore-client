import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDotenv } from "../src/cli/dotenv.js";

test("parsea pares KEY=VALUE básicos", () => {
  assert.deepEqual(parseDotenv("FOO=bar\nBAZ=qux"), { FOO: "bar", BAZ: "qux" });
});

test("ignora líneas de comentario", () => {
  assert.deepEqual(parseDotenv("# comentario\nKEY=val"), { KEY: "val" });
});

test("ignora líneas vacías", () => {
  assert.deepEqual(parseDotenv("\n\nKEY=val\n\n"), { KEY: "val" });
});

test("maneja valores con = interno", () => {
  assert.deepEqual(parseDotenv("URL=https://x?a=b&c=d"), { URL: "https://x?a=b&c=d" });
});

test("strip comillas dobles rodeando el valor", () => {
  assert.deepEqual(parseDotenv('KEY="hello world"'), { KEY: "hello world" });
});

test("strip comillas simples rodeando el valor", () => {
  assert.deepEqual(parseDotenv("KEY='hello world'"), { KEY: "hello world" });
});

test("acepta valor vacío (KEY=)", () => {
  assert.deepEqual(parseDotenv("KEY="), { KEY: "" });
});

test("strip line endings CRLF", () => {
  assert.deepEqual(parseDotenv("FOO=bar\r\nBAZ=qux\r\n"), { FOO: "bar", BAZ: "qux" });
});

test("strip prefijo export", () => {
  assert.deepEqual(parseDotenv("export KEY=VALUE"), { KEY: "VALUE" });
});

test("ignora líneas sin signo igual", () => {
  assert.deepEqual(parseDotenv("SINIGUAL\nKEY=ok"), { KEY: "ok" });
});

test("trim espacios alrededor de key y valor", () => {
  assert.deepEqual(parseDotenv("  KEY  =  value  "), { KEY: "value" });
});
