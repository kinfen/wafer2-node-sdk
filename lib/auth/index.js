const debug = require('debug')('qcloud-sdk[auth]')
const http = require('axios')
const moment = require('moment')
const config = require('../../config')
const qcloudProxyLogin = require('../helper/qcloudProxyLogin')
const AuthDbService = require('../mongoose/AuthDbService')
const sha1 = require('../helper/sha1')
const aesDecrypt = require('../helper/aesDecrypt')
const { ERRORS, LOGIN_STATE } = require('../constants')

/**
 * 授权模块
 * @param {express request} req
 * @return {Promise}
 * @example 基于 Express
 * authorization(this.req).then(userinfo => { // ...some code })
 */
function authorization (req) {
    const {
        'x-wx-code': code,
    } = req.headers;
    
    // 检查 headers
    if ([code].some(v => !v)) {
        debug(ERRORS.ERR_HEADER_MISSED)
        throw new Error(ERRORS.ERR_HEADER_MISSED)
    }
    // 获取 session key
    return getSessionKey(code)
        .then(pkg => {
            const { session_key, openid } = pkg
            // 生成 3rd_session
            const skey = sha1(session_key)

            // 存储到数据库中
            return AuthDbService.saveUserInfo({
                // userInfo:decryptedData, 
                skey,
                open_id:openid,
                session_key
            }).then(result => ({
                loginState: LOGIN_STATE.SUCCESS,
                skey:result.skey
            }))
        }).catch((e) => {
            return {
                loginState: LOGIN_STATE.FAILED,
                skey:null,
            }
        });
}

/**
 * 鉴权模块
 * @param {express request} req
 * @return {Promise}
 * @example 基于 Express
 * validation(this.req).then(loginState => { // ...some code })
 */
function validation (req) {
    const { 
        'x-wx-skey': skey,
        'x-wx-encrypted-data': encryptedData,
        'x-wx-iv': iv
     } = req.headers
    // 检查 headers
    if ([skey, encryptedData, iv].some(v => !v)) {
        debug(ERRORS.ERR_HEADER_MISSED)
        throw new Error(ERRORS.ERR_HEADER_MISSED)
    }
    debug('AValid: skey: %s, encryptedData: %s, iv: %s', skey, encryptedData, iv)
    return AuthDbService.getUserInfoBySKey(skey)
        .then(result => {
            if (result.length === 0) {
                debug('Valid: skey changed, login failed.')
                return {
                    loginState: LOGIN_STATE.FAILED,
                    userinfo: {}
                }
            }
            else result = result[0]
            // 效验登录态是否过期
            const { last_visit_time: lastVisitTime, session_key, open_id } = result
            const expires = config.wxLoginExpires && !isNaN(parseInt(config.wxLoginExpires)) ? parseInt(config.wxLoginExpires) * 1000 : 7200 * 1000;

            if (moment(lastVisitTime, 'YYYY-MM-DD HH:mm:ss').valueOf() + expires < Date.now()) {
                debug('Valid: skey expired, login failed.')
                return {
                    loginState: LOGIN_STATE.FAILED,
                    userinfo: {}
                }
            } else {
                debug('Valid: login success.')

                let decryptedData
                try {  
                    decryptedData = aesDecrypt(session_key, iv, encryptedData);
                    decryptedData = JSON.parse(decryptedData)
                } catch (e) {
                    debug('Auth: %s: %o', ERRORS.ERR_IN_DECRYPT_DATA, e)
                    throw new Error(`${ERRORS.ERR_IN_DECRYPT_DATA}\n${e}`)
                }

                return AuthDbService.saveUserInfo({
                    userInfo:decryptedData, 
                    skey,
                    open_id,
                    session_key
                }).then(result => ({
                    loginState: LOGIN_STATE.SUCCESS,
                    userinfo:result.userinfo
                }))

            }
        })
}

/**
 * Express 授权中间件
 * 基于 authorization 重新封装
 * @param {koa context} req express req
 * @return {Promise}
 */
async function authorizationMiddleware (req, res, next) {

    authorization(req).then((result) => {
        req.state = req.state || {};
        req.state.$wxInfo = result
        return next()
    });
}

/**
 * Koa 鉴权中间件
 * 基于 validation 重新封装
 * @param {koa context} ctx koa 请求上下文
 * @return {Promise}
 */
function validationMiddleware (req, res, next) {
    validation(req).then(result => {
        req.state = req.state || {};
        req.state.$wxInfo = result
        return next()
    }).catch((e) => {
        console.log(e)
    })
}

/**
 * session key 交换
 * @param {string} appid
 * @param {string} appsecret
 * @param {string} code
 * @return {Promise}
 */
function getSessionKey (code) {
    const useQcloudLogin = config.useQcloudLogin

    // 使用腾讯云代小程序登录
    if (useQcloudLogin) {
        const { qcloudSecretId, qcloudSecretKey } = config
        return qcloudProxyLogin(qcloudSecretId, qcloudSecretKey, code).then(res => {
            res = res.data
            if (res.code !== 0 || !res.data.openid || !res.data.session_key) {
                debug('%s: %O', ERRORS.ERR_GET_SESSION_KEY, res)
                throw new Error(`${ERRORS.ERR_GET_SESSION_KEY}\n${JSON.stringify(res)}`)
            } else {
                debug('openid: %s, session_key: %s', res.data.openid, res.data.session_key)
                return res.data
            }
        })
    } else {
        const appid = config.appId
        const appsecret = config.appSecret

        return http({
            url: 'https://api.weixin.qq.com/sns/jscode2session',
            method: 'GET',
            params: {
                appid: appid,
                secret: appsecret,
                js_code: code,
                grant_type: 'authorization_code'
            }
        }).then(res => {
            res = res.data
            if (res.errcode || !res.openid || !res.session_key) {
                debug('%s: %O', ERRORS.ERR_GET_SESSION_KEY, res.errmsg)
                throw new Error(`${ERRORS.ERR_GET_SESSION_KEY}\n${JSON.stringify(res)}`)
            } else {
                debug('openid: %s, session_key: %s', res.openid, res.session_key)
                return res
            }
        })
    }
}

module.exports = {
    authorization,
    validation,
    authorizationMiddleware,
    validationMiddleware
}
