const debug = require('debug')('qcloud-sdk[AuthDbService]')
const uuidGenerator = require('uuid/v4')
const moment = require('moment')
const ERRORS = require('../constants').ERRORS
const mongoose = require('./index')
var _ = require('lodash');

/**
 * 储存用户信息
 * @param {object} userInfo
 * @param {string} sessionKey
 * @return {Promise}
 */
function saveUserInfo (userInfo, skey, session_key) {
    const uuid = uuidGenerator()
    const create_time = moment().format('YYYY-MM-DD HH:mm:ss')
    const last_visit_time = create_time
    const open_id = userInfo.openId
    const user_info = JSON.stringify(userInfo)

    let Model = mongoose.instance.models['SessionInfo'];
    return Model.findOne({
        open_id,
    }).exec()
    .then((doc) => {
        let data = {
            uuid,
            create_time,
            last_visit_time,
            open_id,
            skey,
            user_info,
        };
        if (doc){
            _.assign(doc, data)
            return doc.save();
        }
        else {
            var info = new Model(data);
            return info.save();
        }
        
    })
    .then((doc)=>{
        return {
            userinfo:userInfo,
            skey,
        }
    })
    .catch(e => {
        debug('%s: %O', ERRORS.DBERR.ERR_WHEN_INSERT_TO_DB, e)
        throw new Error(`${ERRORS.DBERR.ERR_WHEN_INSERT_TO_DB}\n${e}`)
    });
}

/**
 * 通过 skey 获取用户信息
 * @param {string} skey 登录时颁发的 skey 为登录态标识
 */
function getUserInfoBySKey (skey) {
    if (!skey) throw new Error(ERRORS.DBERR.ERR_NO_SKEY_ON_CALL_GETUSERINFOFUNCTION)

    // return mysql('SessionInfo').select('*').where({
    //     skey
    // })
    let Model = mongoose.instance.models['SessionInfo'];
    return Model.find({
        skey,
    }).exec();
}

module.exports = {
    saveUserInfo,
    getUserInfoBySKey
}
