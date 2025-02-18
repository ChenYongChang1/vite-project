import fs from 'node:fs'

import { globalSetting } from '../common/collect.js'
import { createFileWidthPath } from '../common/utils.js';

import tencentcloud from 'tencentcloud-sdk-nodejs-tmt';
const TmtClient = tencentcloud.tmt.v20180321.Client

const translateTo = ({
    target,
    textConfig
}) => {
    const translateLenLimit = 2000 // a request content max length
    const secondRequestLimit = 5 // the max times per second to request
    let sum = 0
    let splitConfig = {}
    let splitList = []
    let secondList = []

    for (const key in textConfig) {
        const value = textConfig[key]
        sum += value.length
        if (value.length > translateLenLimit) {
            throw 'i18n-auto-webpack : translate error —— The translate request UnsupportedOperation.TextTooLong'
        }
        if (sum > translateLenLimit) {
            splitList.push(splitConfig)
            splitConfig = {}
            sum = value.length
            splitConfig[key] = value
        } else {
            splitConfig[key] = value
        }
    }
    splitList.push(splitConfig)
    const groupNum = Math.ceil(splitList.length / secondRequestLimit)
    for (let i = 0; i < groupNum; i++) {
        const start = i * secondRequestLimit
        secondList.push(splitList.slice(start, start + 5))
    }
    return timeOutSend(target, secondList, 0)
}

const timeOutSend = (target, secondList, i) => {
    return new Promise((resolve, reject) => {
        const list = secondList[i]
        const promises = []
        list.forEach(item => {
            const promise = send(target, item)
            promises.push(promise)
        })
        Promise.all(promises).then(res => {
            const result = res.reduce((config, result) => {
                return Object.assign(result, config)
            }, {})
            const nextI = i + 1
            if (nextI < secondList.length) {
                setTimeout(async () => {
                    const res = await timeOutSend(target, secondList, nextI)
                    Object.assign(result, res)
                    return resolve(result)
                }, nextI * 1100)
            } else {
                return resolve(result)
            }
        }).catch(err => {
            reject(err)
        })
    })
}

/**
 * send the request to translate
 */
const send = (target, textConfig) => {
    const {
        secretId,
        secretKey,
        region,
        endpoint,
        source,
        projectId,
    } = globalSetting.translate || {}
    const clientConfig = {
        credential: {
            secretId,
            secretKey,
        },
        region,
        profile: {
            httpProfile: {
                endpoint
            }
        }
    }
    return new Promise((resolve, reject) => {
        let result = {}
        const keys = Object.keys(textConfig)
        const values = Object.values(textConfig)
        const params = {
            Source: source,
            Target: target,
            ProjectId: projectId,
            SourceTextList: values
        }
        const client = new TmtClient(clientConfig)
        client.TextTranslateBatch(params).then(
            (data) => {
                keys.forEach((key, index) => {
                    result[key] = data.TargetTextList[index]
                })
                return resolve(result)
            },
            err => {
                console.error("i18n-auto-webpack : translate error", err)
                return reject(err)
            }
        )
    })
}

const createTranslate = (target, source, needFile = true) => {
    return new Promise((resolve, reject) => {
        const {
            path,
            lang,
            nameRule
        } = target
        const {
            path: sourcePath,
            text,
        } = source
        const localeConfig = text || JSON.parse(fs.readFileSync(sourcePath, { encoding: 'utf8' }))
        const result = {}
        const translateLang = (index) => {
            const item = lang[index]
            const fileName = nameRule(item)
            const filePath = path + '/' + fileName
            let deletedKeys = []
            fs.access(filePath, fs.constants.F_OK, async (err) => {
                let translateWordConfig = {}
                let langConfig = {}
                if (err) {
                    for (const key in localeConfig) {
                        translateWordConfig[key] = localeConfig[key]
                    }
                } else {
                    langConfig = fs.readFileSync(filePath, { encoding: 'utf8' })
                    langConfig = JSON.parse(langConfig)
                    deletedKeys = Object.keys(langConfig).filter(key => !Object.keys(localeConfig).some(localeKey => localeKey === key))
                    deletedKeys.forEach(key => {
                        delete langConfig[key]
                    })
                    for (const key in localeConfig) {
                        if (!langConfig[key]) {
                            translateWordConfig[key] = localeConfig[key]
                        }
                    }
                }
                const translationFileParam = {
                    content: JSON.stringify(langConfig),
                    path,
                    filename: fileName
                }
                if (Object.keys(translateWordConfig).length) {
                    if (!validateLimit(translateWordConfig)) {
                        return reject(`translate ${item} failed: The terms that need to be translated exceed the free quota for characters!`)
                    }
                    try {
                        const translateRes = await translateTo({
                            target: item,
                            textConfig: translateWordConfig
                        })
                        Object.assign(langConfig, translateRes)

                        translationFileParam.content = JSON.stringify(langConfig)
                        needFile && createFileWidthPath(translationFileParam)
                        result[item] = langConfig
                    } catch (e) {
                        return reject(e)
                    }
                } else if (deletedKeys.length) {
                    needFile && createFileWidthPath(translationFileParam)
                }
                index++
                if (index < lang.length) {
                    setTimeout(() => {
                        translateLang(index)
                    }, 1100)
                } else {
                    return resolve(result)
                }
            })
        }
        translateLang(0)
    })
}

function validateLimit (textConfig) {
    const { startTotal, endTotal } = globalSetting.translate || {}
    if (endTotal === Infinity) {
        return true
    }
    let len = 0
    for (const key in textConfig) {
        len += textConfig[key].length
    }
    const total = startTotal + len
    if (total > endTotal) {
        return false
    }
    globalSetting.translate.startTotal = total
    return true
}

export default createTranslate
