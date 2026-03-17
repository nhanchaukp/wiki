const bcrypt = require('bcryptjs-then')
const request = require('request')
const _ = require('lodash')

/* global WIKI */

// ------------------------------------
// Local Account
// ------------------------------------

const LocalStrategy = require('passport-local').Strategy

function getUserInfo(token, deviceId, deviceToken, isProd) {
  WIKI.logger.info(`[Auth] getUserInfo with deviceId: ${deviceId}`)
  return new Promise((resolve, reject) => {
    const options = {
      'method': 'POST',
      'url': 'https://sso.sysone.vn/cobra-auth-service/api/auth/profile',
      'headers': {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'deviceId': deviceId,
        'deviceToken': deviceToken
      },
      body: '{}'
    }
    WIKI.logger.debug(`[Auth] Send request getUserInfo with options: ${JSON.stringify(options)}`)

    request(options, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        WIKI.logger.info(`[Auth] Get user information successful`)
        WIKI.logger.debug(`[Auth] User data: ${body}`)
        resolve(JSON.parse(body)['object'])
      } else {
        WIKI.logger.error(`[Auth] Error getting user information: ${error}`)
        WIKI.logger.error(`[Auth] Response status: ${response ? response.statusCode : 'no response'}`)
        WIKI.logger.error(`[Auth] Response body: ${body}`)
        reject(error)
      }
    })
  })
}

function loginSSO(username, otp) {
  return new Promise((resolve, reject) => {
    var deviceId = 'wiki' + username
    WIKI.logger.info(`[Auth] Start SSO login with username: ${username} and deviceId: ${deviceId}`)

    var options = {
      'method': 'POST',
      'url': 'https://sso.sysone.vn/cobra-auth-service/oauth2/token',
      'headers': {
        'Authorization': 'Basic Y29icmEtd2lraS1hcHA6N2VSN2EyN2FlMzFlOVMyNWVmZmJkOThlODZmN2Y=',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      form: {
        'grant_type': 'password',
        'username': username,
        'password': otp,
        'deviceId': deviceId
      }
    }
    WIKI.logger.debug(`[Auth] Send request loginSSO with options: ${JSON.stringify(options)}`)

    request(options, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        WIKI.logger.info(`[Auth] SSO login successful`)
        try {
          const json = JSON.parse(body)
          WIKI.logger.debug(`[Auth] Token received: ${json['access_token'] ? 'has token' : 'no token'}`)
          WIKI.logger.debug(`[Auth] DeviceToken received: ${json['deviceToken'] ? 'has deviceToken' : 'no deviceToken'}`)

          getUserInfo(json['access_token'], deviceId, json['deviceToken'])
            .then(json => {
              WIKI.logger.info(`[Auth] Get user information successful`)
              resolve(json)
            })
            .catch(error => {
              WIKI.logger.error(`[Auth] Error getting user information: ${error}`)
              reject(error)
            })
        } catch (parseError) {
          WIKI.logger.error(`[Auth] Error parsing JSON from response: ${parseError}`)
          WIKI.logger.error(`[Auth] Response body: ${body}`)
          reject(parseError)
        }
      } else {
        WIKI.logger.error(`[Auth] SSO login failed: ${error}`)
        WIKI.logger.error(`[Auth] Response status: ${response ? response.statusCode : 'no response'}`)
        WIKI.logger.error(`[Auth] Response body: ${body}`)
        reject(error)
      }
    })
  })
}

module.exports = {
  init (passport, conf) {
    passport.use('local',
      new LocalStrategy({
        usernameField: 'email',
        passwordField: 'password'
      }, async (uEmail, uPassword, done) => {
        try {
          var logicSuccess = false

          await loginSSO(uEmail, uPassword).then(async(loginInfo) => {
            const email = uEmail + '@sysone.vn'.toLocaleLowerCase()
            const profile = {
              id: uEmail,
              email: email,
              displayName: loginInfo['fullName']
            }

            // must allow self-registration https://wiki.sysone.vn/a/auth
            const user = await WIKI.models.users.processProfile({
              providerKey: 'local',
              profile: profile
            })

            // find group in db with departmentName
            const departmentName = 'Team SysOne'
            // const departmentName = loginInfo['departmentName']
            const findGroup = await WIKI.models.groups.query().where('name', departmentName).first()

            // group exist
            if (findGroup) {
              const currentGroupIds = (await user.$relatedQuery('groups').select('groups.id')).map(g => g.id)
              // assign user to group if not current
              if (!currentGroupIds.includes(findGroup.id)) {
                await user.$relatedQuery('groups').relate(findGroup)
              }
            } else { // create new
              const newGroup = await WIKI.models.groups.query().insert({
                name: departmentName,
                permissions: JSON.stringify(WIKI.data.groups.defaultPermissions),
                pageRules: JSON.stringify(WIKI.data.groups.defaultPageRules),
                isSystem: false
              })

              // assign user to new group
              await user.$relatedQuery('groups').relate(newGroup)
            }

            console.log('done login', user)

            logicSuccess = true
            done(null, user)
          }).catch(error => {
            console.error('Error during SSO login:', error)
            WIKI.logger.error(error)
            done(new WIKI.Error.AuthLoginFailed(), null)
          })

          if (!logicSuccess) {
            // step authenticate with local account
            const user = await WIKI.models.users.query().findOne({
              email: uEmail.toLowerCase(),
              providerKey: 'local'
            })
            if (user) {
              await user.verifyPassword(uPassword)
              if (!user.isActive) {
                done(new WIKI.Error.AuthAccountBanned(), null)
              } else if (!user.isVerified) {
                done(new WIKI.Error.AuthAccountNotVerified(), null)
              } else {
                done(null, user)
              }
            } else {
            // Fake verify password to mask timing differences
              await bcrypt.compare((Math.random() + 1).toString(36), '$2a$12$irXbAcQSY59pcQQfNQpY8uyhfSw48nzDikAmr60drI501nR.PuBx2')

              done(new WIKI.Error.AuthLoginFailed(), null)
            }
          }
        } catch (err) {
          done(err, null)
        }
      })
    )
  }
}
