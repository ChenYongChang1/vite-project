import { highlightText } from "./utils";
import * as _ from "lodash";

import findTextInJs from "./findTextInJs";

import findTextInVue from "./findTextInVue";

const fs = require("fs");
const path = require("path");

/**
 * 判断是文件夹
 * @param path
 */
function isDirectory(path) {
  return fs.statSync(path).isDirectory();
}
function readAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(function (file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = readAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}
/**
 * 读取文件
 * @param fileName
 */
function readFile(fileName) {
  if (fs.existsSync(fileName)) {
    return fs.readFileSync(fileName, "utf-8");
  }
}
function findChineseText(code, fileName) {
  if (fileName.endsWith(".html")) {
    // return findTextInHtml(code);
  } else if (fileName.endsWith(".vue")) {
    return findTextInVue(code);
  } else if (fileName.endsWith(".js") || fileName.endsWith(".jsx")) {
    return findTextInJs(code);
  } else {
    // return findTextInTs(code, fileName);
  }
}
function findAllChineseText(dir) {
  let files = readAllFiles(dir);

  const allTexts = files.reduce((pre, file) => {
    const code = readFile(file);
    const texts = findChineseText(code, file);
    console.log(texts, "texts");

    // 调整文案顺序，保证从后面的文案往前替换，避免位置更新导致替换出错
    const sortTexts = _.sortBy(texts, (obj) => -obj.range.start);
    if (texts.length > 0) {
      console.log(
        `${highlightText(file)} 发现 ${highlightText(texts.length)} 处中文文案`
      );
    }

    return texts.length > 0 ? pre.concat({ file, texts: sortTexts }) : pre;
  }, []);
  return allTexts;
}
export default findAllChineseText;
