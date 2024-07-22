const { parse, compileTemplate } = require("@vue/compiler-sfc");
const DOUBLE_BYTE_REGEX = /[\u4E00-\u9FFF]/g;
const babel = require("@babel/core");
const ts = require("typescript");

function findTextInVue(code) {
  let rexspace1 = new RegExp(/&ensp;/, "g");
  let rexspace2 = new RegExp(/&emsp;/, "g");
  let rexspace3 = new RegExp(/&nbsp;/, "g");
  code = code
    .replace(rexspace1, "ccsp&;")
    .replace(rexspace2, "ecsp&;")
    .replace(rexspace3, "ncsp&;");
  let coverRex1 = new RegExp(/ccsp&;/, "g");
  let coverRex2 = new RegExp(/ecsp&;/, "g");
  let coverRex3 = new RegExp(/ncsp&;/, "g");
  let matches = [];
  let result;

  const { descriptor } = parse(code);
  const templateOffset = descriptor.template?.loc?.start?.offset;
  console.log(templateOffset, "descriptor");

  const template = descriptor.template ? descriptor.template.content : "";
  const compiled = compileTemplate({ source: template });
  let vueAst = compiled.ast;

  let expressTemp = findVueText(vueAst);
  expressTemp.forEach((item) => {
    item.arrf = [item.loc.start.offset, item.loc.end.offset];
  });
  matches = expressTemp;

  let outcode = compiled.code.toString().replace("with(this)", "function a()");
  let vueTemp = transerI18n(outcode, "as.vue");

  vueTemp = vueTemp.map((item) => item.trim());
  vueTemp = Array.from(new Set(vueTemp));

  vueTemp.forEach((item) => {
    let items = item
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}")
      .replace(/\$/g, "\\$")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/\+/g, "\\+")
      .replace(/\*/g, "\\*")
      .replace(/\^/g, "\\^");
    let rex = new RegExp(items, "g");
    let codeTemplate = template.substring(
      vueAst.loc.start.offset,
      vueAst.loc.end.offset
    );

    while ((result = rex.exec(codeTemplate))) {
      let res = result;
      const startIndex = res.index + templateOffset;
      let last = rex.lastIndex + templateOffset;
      last = last - (res[0].length - res[0].trimRight().length);
      const range = { start: startIndex, end: last };
      matches.push({
        arrf: [startIndex, last],
        range,
        text: res[0]
          .trimRight()
          .replace(coverRex1, "&ensp;")
          .replace(coverRex2, "&emsp;")
          .replace(coverRex3, "&nbsp;"),
        isString:
          (codeTemplate.substr(startIndex - 1, 1) === '"' &&
            codeTemplate.substr(last, 1) === '"') ||
          (codeTemplate.substr(startIndex - 1, 1) === "'" &&
            codeTemplate.substr(last, 1) === "'")
            ? true
            : false
      });
    }
  });

  let matchesTemp = matches;
  let matchesTempResult = matchesTemp.filter((item) => {
    let canBe = true;
    matchesTemp.forEach((items) => {
      if (
        (item.arrf[0] > items.arrf[0] && item.arrf[1] <= items.arrf[1]) ||
        (item.arrf[0] >= items.arrf[0] && item.arrf[1] < items.arrf[1]) ||
        (item.arrf[0] > items.arrf[0] && item.arrf[1] < items.arrf[1])
      ) {
        canBe = false;
      }
    });
    if (canBe) return item;
  });

  const scriptContent = descriptor.script ? descriptor.script.content : "";
  return matchesTempResult;
}

function findVueText(ast) {
  let arr = [];
  const regex1 = /\`(.+?)\`/g;
  function emun(ast) {
    if (ast.expression) {
      let text = ast.expression.match(regex1);
      if (text && text[0].match(DOUBLE_BYTE_REGEX)) {
        text.forEach((itemText) => {
          const varInStr = itemText.match(/(\$\{[^\}]+?\})/g);
          if (varInStr)
            itemText.match(DOUBLE_BYTE_REGEX) &&
              arr.push({
                text: " " + itemText,
                range: {
                  start: ast.loc.start.offset + 2,
                  end: ast.loc.end.offset - 2
                },
                isString: true
              });
          else
            itemText.match(DOUBLE_BYTE_REGEX) &&
              arr.push({
                text: itemText,
                range: { start: ast.loc.start.offset, end: ast.loc.end.offset },
                isString: false
              });
        });
      } else {
        ast.children &&
          ast.children.forEach((element) => {
            if (
              typeof element === "string" &&
              element.match(DOUBLE_BYTE_REGEX)
            ) {
              arr.push({
                text: element,
                range: {
                  start: ast.loc.start.offset + ast.text.indexOf(element),
                  end:
                    ast.loc.start.offset +
                    ast.text.indexOf(element) +
                    element.length
                },
                isString: false
              });
            }
          });
      }
    } else if (!ast.expression && ast.text) {
      ast.text.match(DOUBLE_BYTE_REGEX) &&
        arr.push({
          text: ast.text,
          range: { start: ast.loc.start.offset, end: ast.loc.end.offset },
          isString: false
        });
    } else {
      ast.children &&
        ast.children.forEach((item) => {
          emun(item);
        });
    }
  }
  emun(ast);
  return arr;
}

function transerI18n(code, filename) {
  return javascriptI18n(code, filename);
}

function javascriptI18n(code, filename) {
  let arr = [];
  let visitor = {
    StringLiteral(path) {
      if (path.node.value.match(DOUBLE_BYTE_REGEX)) {
        arr.push(path.node.value);
      }
    }
  };
  let arrayPlugin = { visitor };
  babel.transformSync(code.toString(), {
    filename,
    plugins: [arrayPlugin]
  });
  return arr;
}

function findTextInVueTs(code, fileName, startNum) {
  const matches = [];
  const ast = ts.createSourceFile(
    "",
    code,
    ts.ScriptTarget.ES2015,
    true,
    ts.ScriptKind.TS
  );

  function visit(node) {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral: {
        const { text } = node;
        if (text.match(DOUBLE_BYTE_REGEX)) {
          const start = node.getStart();
          const end = node.getEnd();
          const range = { start: start + startNum, end: end + startNum };
          matches.push({
            range,
            text,
            isString: true
          });
        }
        break;
      }
      case ts.SyntaxKind.TemplateExpression: {
        const { pos, end } = node;
        let templateContent = code.slice(pos, end);
        templateContent = templateContent
          .toString()
          .replace(/\$\{[^\}]+\}/, "");
        if (templateContent.match(DOUBLE_BYTE_REGEX)) {
          const start = node.getStart();
          const end = node.getEnd();
          const range = { start: start + startNum, end: end + startNum };
          matches.push({
            range,
            text: code.slice(start + 1, end - 1),
            isString: true
          });
        }
        break;
      }
    }

    ts.forEachChild(node, visit);
  }
  ts.forEachChild(ast, visit);

  return matches;
}

export default findTextInVue;
