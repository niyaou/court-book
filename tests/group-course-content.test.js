"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const content = require("../utils/groupCourseContent");
const view = require("../utils/groupCourseView");
const { fixture } = require("../cloudfunctions/group_course/test/helpers");
const { C } = require("../cloudfunctions/group_course/lib/core");

const delta = { ops: [
  { insert: "训练目标" }, { insert: "\n", attributes: { header: 2, align: "center" } },
  { insert: "正手", attributes: { bold: true, italic: true, underline: true } },
  { insert: "练习\n", attributes: { list: "ordered" } },
  { insert: "反手\n", attributes: { list: "ordered" } },
  { insert: "\n" },
  { insert: "  自带球拍\n", attributes: { list: "bullet" } },
  { insert: "欢迎参加\n", attributes: { align: "right" } },
] };

test("renders heading, inline formats, consecutive lists, blank lines, spaces and alignment", () => {
  const html = content.nodes({ description: content.encode(delta) });
  assert.match(html, /<h2 style="[^"]*text-align:center[^"]*">训练目标<\/h2>/);
  assert.match(html, /<ol[^>]*><li[^>]*>.*正手.*<\/li><li[^>]*>反手<\/li><\/ol>/);
  assert.match(html, /font-weight:bold;font-style:italic;text-decoration:underline/);
  assert.match(html, /<p[^>]*><br><\/p>/);
  assert.match(html, /<ul[^>]*><li[^>]*>  自带球拍<\/li><\/ul>/);
  assert.match(html, /text-align:right/);
});

test("plain legacy text stays literal and preserves CRLF, blank lines and spaces", () => {
  const nodes = content.nodes({ description: "<b>普通文字</b>\r\n\r\n  缩进" });
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].children[0].text, "<b>普通文字</b>");
  assert.equal(nodes[1].children[0].name, "br");
  assert.equal(nodes[2].children[0].text, "  缩进");
  assert.equal(content.editorContents({ description: "普通\n内容" }).delta.ops[0].insert, "普通\n内容\n");
});

test("database literal newline escapes display and load into the editor as real line breaks", () => {
  const description = String.raw`训练目标\n正手练习\n\n注意事项\r\n请自带球拍\r结束`;
  const expected = "训练目标\n正手练习\n\n注意事项\n请自带球拍\n结束";
  assert.deepEqual(content.nodes({ description }), content.nodes({ description: expected }));
  assert.equal(content.editorContents({ description }).delta.ops[0].insert, expected + "\n");
  const mixed = "第一行\n第二行\\n第三行\r\n第四行";
  assert.equal(content.editorContents({ description: mixed }).delta.ops[0].insert,
    "第一行\n第二行\n第三行\n第四行\n");
});

test("newline compatibility leaves other escapes, literal HTML and encoded rich content alone", () => {
  const description = String.raw`<b>文字</b>\n\t缩进\u4e2d`;
  const nodes = content.nodes({ description });
  assert.equal(nodes[0].children[0].text, "<b>文字</b>");
  assert.equal(nodes[1].children[0].text, String.raw`\t缩进\u4e2d`);
  const rich = content.encode({ ops: [{ insert: String.raw`保留字面\n内容` + "\n" }] });
  assert.match(content.nodes({ description: rich }), /保留字面\\n内容/);
  assert.equal(content.editorContents({ description: rich }).html, content.nodes({ description: rich }));
});

test("normalization permits only supported formats and limits the stored document", () => {
  const normalized = content.normalize({ ops: [{ insert: "<script>\n", attributes: {
    bold: true, color: "red", link: "javascript:alert(1)", align: "left;display:none", header: 99,
  } }] });
  assert.deepEqual(normalized, { ops: [{ insert: "<script>\n", attributes: { bold: true } }] });
  assert.throws(() => content.normalize({ ops: [{ insert: { image: "x" } }] }));
  assert.throws(() => content.normalize({ ops: [{ retain: 3 }] }));
  assert.throws(() => content.normalize({ ops: [{ insert: "a".repeat(20001) }] }));
  assert.throws(() => content.normalize({ ops: Array(10001).fill({ insert: "" }) }));
});

test("unchanged backend round-trips formatted description through template, database, detail and replay", async () => {
  const f = await fixture();
  const template = { title: "模板", description: content.encode({ ops: [{ insert: "原模板\n" }] }), enabled: true };
  await f.repo.set("group_course_template", "template", template);
  const context = await f.request("admin", "context");
  assert.deepEqual(content.editorContents(context.data.templates[0]), { html: content.nodes(template) });
  const payload = { description: content.encode(delta) };
  const result = await f.publish(payload);
  assert.equal(result.success, true);
  const stored = await f.repo.get(C.course, result.data.courseId);
  assert.equal(Object.hasOwn(stored, "descriptionDelta"), false);
  assert.equal(Object.hasOwn(stored, "editorDelta"), false);
  assert.equal(stored.description, payload.description);
  assert.equal((await f.repo.get("group_course_template", "template")).description, template.description);
  const detail = await f.request("user", "detail", { courseId: result.data.courseId });
  assert.deepEqual(view.course(detail.data.course).descriptionNodes, content.nodes(payload));
  assert.equal((await f.publish(payload)).data.replayed, true);
  const changed = JSON.parse(JSON.stringify(delta));
  changed.ops[1].attributes.align = "right";
  assert.equal((await f.publish({ description: content.encode(changed) })).error, "REQUEST_ID_CONFLICT");
});

test("frontend rejects empty/media content and counts markup against the existing server limit", () => {
  assert.throws(() => content.encode({ ops: [{ insert: "\n  \n" }] }), /请填写教学详情/);
  assert.throws(() => content.encode({ ops: [{ insert: { image: "x" } }] }));
  assert.throws(() => content.encode({ ops: [{ insert: "x".repeat(20000) }] }), /精简文字或排版/);
  assert.throws(() => content.encode({ ops: [{ insert: "&".repeat(5000) }] }), /精简文字或排版/);
});

test("HTML serializer escapes literal tags and attributes and only emits supported formatting", () => {
  const html = content.encode({ ops: [{ insert: '<img src="x"> & <script>x</script>\n', attributes: {
    bold: true, link: "javascript:alert(1)", color: "red", align: "left;display:none",
  } }] });
  assert.match(html, /&lt;img src=&quot;x&quot;&gt; &amp; &lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script|javascript:|display:none|color:red/);
  assert.match(html, /font-weight:bold/);
});

test("plain legacy pending publish retains its original request and description", async () => {
  const f = await fixture();
  const description = "老课程\n\n练习内容";
  const result = await f.publish({ description });
  assert.equal(result.success, true);
  assert.equal((await f.publish({ description })).data.replayed, true);
  const detail = await f.request("user", "detail", { courseId: result.data.courseId });
  assert.deepEqual(view.course(detail.data.course).descriptionNodes, content.nodes({ description }));
});
