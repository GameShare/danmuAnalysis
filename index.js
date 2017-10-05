const io = require('socket.io-client')
const logger = require('./lib/logger.js')('danmuAnlysis')
const BilibiliClient = require('./lib/BilibiliClient.js')

async function main () {
  let client = new BilibiliClient(process.argv[2])
  let socket = io.connect('http://localhost:6000')
  await client.init()
  let url = await client.getLiveAddress(client.roomID)
  logger.info(`视频地址: ${url}`)
  socket.emit('data', `视频地址: ${url}`)
  client.start()
  client.on('onlineNumber', (number) => {
    logger.info(`在线人数:${number}`)
    socket.emit('data', `在线人数:${number}`)
  })
  client.on('data', (data) => {
    // logger.debug(data)
    switch (data.cmd) {
      case 'SEND_GIFT':
        logger.info(`${data.data.uname} 赠送 ${data.data.giftName} x ${data.data.num}`)
        socket.emit('data', `${data.data.uname} 赠送 ${data.data.giftName} x ${data.data.num}`)
        break
      case 'DANMU_MSG':
        logger.info(`${data.info[2][1]} 说: ${data.info[1]}`)
        socket.emit('data', `${data.info[2][1]} 说: ${data.info[1]}`)
        break
      case 'ROOM_BLOCK_MSG':
        logger.info(`${data.uname} 已被禁言`)
        socket.emit('data', `${data.uname} 已被禁言`)
        break
      case 'LIVE':
        logger.info(`直播开始`)
        break
      case 'PREPARING':
        logger.info(`直播结束`)
        break
      case 'WELCOME':
      case 'WELCOME_ACTIVITY':
        logger.info(`欢迎${data.data.uname}`)
        socket.emit('data', `欢迎${data.data.uname}`)
        break
      case 'WELCOME_GUARD':
      case 'GUARD_BUY':
        logger.info(`欢迎${data.data.username}`)
        socket.emit('data', `欢迎${data.data.username}`)
        break
      case 'SYS_GIFT':
      case 'SYS_MSG':
        logger.info(`${data.msg_text}`)
        socket.emit('data', `${data.msg_text}`)
        break
      default:
        logger.fatal(`Unknown cmd ${data.cmd}`)
        logger.fatal(data)
        break
    }
  })
}

main()

process.on('unhandledRejection', (error) => {
  logger.fatal(`UnhandledRejection: Error.\n${error.name}: ${error.message}\nStack: ${error.stack}`)
})

process.on('uncaughtException', (error) => {
  logger.fatal(`UnhandledRejection: Error.\n${error.name}: ${error.message}\nStack: ${error.stack}`)
})
