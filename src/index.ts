import {
  failInfo,
  findMatchKey,
  findMatchValue,
  highlightText,
  successInfo,
  translateKeyText,
  translateText
} from "./utils.js";
import * as colors from "colors";
import { getSuggestLangObj } from "./extract/getLangData";
import slash from "slash2";
import {
  createImportI18N,
  hasImportI18N,
  replaceAndUpdate
} from "./extract/replace";
import * as _ from "lodash";
import { writeFile } from "./extract/file";
import findAllChineseText from "./findAllChinesText";

const path = require("node:path");
const allTargetStrs = findAllChineseText(path.join(process.cwd(), "./test"));
const prefix = "chagee";
const langsPrefix = prefix ? prefix.replace(/^I18N\./, "") : null;
const origin = "Pinyin";

function getSuggestion(currentFilename: string) {
  let suggestion = [];
  const suggestPageRegex = /\/pages\/\w+\/([^\/]+)\/([^\/\.]+)/;

  if (currentFilename.includes("/pages/")) {
    suggestion = currentFilename.match(suggestPageRegex);
  }
  if (suggestion) {
    suggestion.shift();
  }
  /** 如果没有匹配到 Key */
  if (!(suggestion && suggestion.length)) {
    const names = slash(currentFilename).split("/");
    const fileName = _.last(names) as any;
    const fileKey = fileName.split(".")[0].replace(new RegExp("-", "g"), "_");
    const dir = names[names.length - 2].replace(new RegExp("-", "g"), "_");
    if (dir === fileKey) {
      suggestion = [dir];
    } else {
      suggestion = [dir, fileKey];
    }
  }

  return suggestion;
}

function getReplaceableStrs(
  currentFilename: string,
  langsPrefix: string,
  translateTexts: string[],
  targetStrs: any[]
) {
  const finalLangObj = getSuggestLangObj();
  const virtualMemory = {};
  const suggestion = getSuggestion(currentFilename);
  const replaceableStrs = targetStrs.reduce((prev, curr, i) => {
    const _text = curr.text;
    let key = findMatchKey(finalLangObj, _text);
    if (key) {
      key = key.replace(/-/g, "_");
    }
    if (!virtualMemory[_text]) {
      if (key) {
        virtualMemory[_text] = key;
        return prev.concat({
          target: curr,
          key,
          needWrite: false
        });
      }
      const transText =
        translateTexts[i] && _.camelCase(translateTexts[i] as string);
      let transKey = `${suggestion.length ? suggestion.join(".") + "." : ""}${transText}`;
      transKey = transKey.replace(/-/g, "_");
      if (langsPrefix) {
        transKey = `${langsPrefix}.${transText}`;
      }
      let occurTime = 1;
      // 防止出现前四位相同但是整体文案不同的情况
      while (
        findMatchValue(finalLangObj, transKey) !== _text &&
        _.keys(finalLangObj).includes(
          `${transKey}${occurTime >= 2 ? occurTime : ""}`
        )
      ) {
        occurTime++;
      }
      if (occurTime >= 2) {
        transKey = `${transKey}${occurTime}`;
      }
      virtualMemory[_text] = transKey;
      finalLangObj[transKey] = _text;
      return prev.concat({
        target: curr,
        key: transKey,
        needWrite: true
      });
    } else {
      return prev.concat({
        target: curr,
        key: virtualMemory[_text],
        needWrite: true
      });
    }
  }, []);

  return replaceableStrs;
}
/**
 * 处理作为key值的翻译原文
 */
function getTransOriginText(text: string) {
  // 避免翻译的字符里包含数字或者特殊字符等情况，只过滤出汉字和字母
  const reg = /[a-zA-Z\u4e00-\u9fa5]+/g;
  const findText = text.match(reg) || [];
  const transOriginText = findText ? findText.join("").slice(0, 5) : "中文符号";

  return transOriginText;
}
const generateKeyAndReplace = async (item) => {
  const currentFilename = item.file;
  console.log(`${currentFilename} 替换中...`);
  // 过滤掉模板字符串内的中文，避免替换时出现异常
  const targetStrs = item.texts.reduce((pre, strObj, i) => {
    // 因为文案已经根据位置倒排，所以比较时只需要比较剩下的文案即可
    const afterStrs = item.texts.slice(i + 1);
    if (afterStrs.some((obj) => strObj.range.end <= obj.range.end)) {
      return pre;
    }
    return pre.concat(strObj);
  }, []);
  const len = item.texts.length - targetStrs.length;
  if (len > 0) {
    console.log(
      colors.red(
        `存在 ${highlightText(len)} 处文案无法替换，请避免在模板字符串的变量中嵌套中文`
      )
    );
  }

  let translateTexts;
  //
  if (origin !== "Google") {
    // 翻译中文文案，百度和pinyin将文案进行拼接统一翻译
    const delimiter = origin === "Baidu" ? "\n" : "$";
    const translateOriginTexts = targetStrs.reduce((prev, curr, i) => {
      const transOriginText = getTransOriginText(curr.text);
      if (i === 0) {
        return transOriginText;
      }
      return `${prev}${delimiter}${transOriginText}`;
    }, []);

    translateTexts = await translateKeyText(translateOriginTexts, origin);
  } else {
    // google并发性较好，且未找到有效的分隔符，故仍然逐个文案进行翻译
    const translatePromises = targetStrs.reduce((prev, curr) => {
      const transOriginText = getTransOriginText(curr.text);
      return prev.concat(translateText(transOriginText, "en_US"));
    }, []);

    [...translateTexts] = await Promise.all(translatePromises);
  }

  if (translateTexts.length === 0) {
    failInfo(`未得到翻译结果，${currentFilename}替换失败！`);
    return;
  }

  const replaceableStrs = getReplaceableStrs(
    currentFilename,
    langsPrefix,
    translateTexts,
    targetStrs
  );

  await replaceableStrs
    .reduce((prev, obj) => {
      return prev.then(() => {
        return replaceAndUpdate(
          currentFilename,
          obj.target,
          `I18N.${obj.key}`,
          false,
          obj.needWrite
        );
      });
    }, Promise.resolve())
    .then(() => {
      // 添加 import I18N
      if (!hasImportI18N(currentFilename)) {
        const code = createImportI18N(currentFilename);

        writeFile(currentFilename, code);
      }
      successInfo(
        `${currentFilename} 替换完成，共替换 ${targetStrs.length} 处文案！`
      );
    })
    .catch((e) => {
      console.error(e);
      failInfo(e.message);
    });
};
console.log("all", allTargetStrs);
allTargetStrs
  .reduce((prev, current) => {
    return prev.then(() => {
      return generateKeyAndReplace(current);
    });
  }, Promise.resolve())
  .then(() => {
    successInfo("全部替换完成！");
  })
  .catch((e: any) => {
    failInfo(e.message);
  });
