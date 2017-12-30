const request = require('superagent')
const logger = require('./logger')('BilibiliClient')
const net = require('net')
const EventEmitter = require('events').EventEmitter

const baseURL = 'https://live.bilibili.com'

class BilibiliClient extends EventEmitter {
  constructor (roomID) {
    super()
    this.fakeRoomID = roomID
    this.heartBeatHandler = null
    this.client = new net.Socket()
    this.port = 788
    // this.port = 2243
    this.client.on('close', (error) => {
      this.emit('close', error)
    })
    this.bufferPool = Buffer.from([])
    // posiPool.bufferPoolBeginPointer = 0
    this.client.on('data', (data) => {
      this.bufferPool = Buffer.concat([this.bufferPool, data])
      let msgFlag = Buffer.from([0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00])
      // 开始时出现的
      let beginFlag = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01])
      // 心跳包出现的
      let hbFlag = Buffer.from([0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01])
      let posiPool = []

      let result = 0
      while (result !== -1) {
        result = this.bufferPool.indexOf(beginFlag, result + 1)
        if (result !== -1) {
          posiPool.push({
            type: 'beginPosi',
            posi: result
          })
        }
      }
      result = 0
      while (result !== -1) {
        result = this.bufferPool.indexOf(hbFlag, result + 1)
        if (result !== -1) {
          posiPool.push({
            type: 'hbPosi',
            posi: result
          })
        }
      }
      result = 0
      while (result !== -1) {
        result = this.bufferPool.indexOf(msgFlag, result + 1)
        if (result !== -1) {
          posiPool.push({
            type: 'msgPosi',
            posi: result
          })
        }
      }
      if (posiPool.length >= 2) {
        posiPool.sort((a, b) => {
          if (a.posi < 0) return 1
          if (b.posi < 0) return -1
          return a.posi - b.posi
        })
        for (let index = 1; index < posiPool.length; index++) {
          let beginPosi = posiPool[index - 1]
          let endPosi = posiPool[index]
          switch (beginPosi.type) {
            case 'beginPosi':
              logger.debug(`Begin the buffer. No more info.`)
              break
            case 'hbPosi':
              let audienceNumber = this.bufferPool.slice(beginPosi.posi + 8, endPosi.posi - 8)
              audienceNumber = audienceNumber.readUInt32BE()
              this.emit('onlineNumber', audienceNumber)
              break
            case 'msgPosi':
              let msg = this.bufferPool.slice(beginPosi.posi + 8, endPosi.posi - 8)
              msg = JSON.parse(msg.toString())
              this.emit('data', msg)
              break
            default:
              logger.fatal(`Will not happen!`)
              break
          }
        }
        this.bufferPool = this.bufferPool.slice(posiPool[posiPool.length - 1].posi - 8)
      }
    })

    this.client.on('error', (error) => {
      logger.error(`Erro: ${error.name}\nDescription: ${error.message}\nStack: ${error.stack}`)
    })
  }

  async init () {
    this.roomID = await this.getRoomID(this.fakeRoomID)
    this.danmuServer = await this.getDammuServerAddress(this.roomID)
  }

  async getRoomID (fakeRoomID) {
    let result = await request.get(`http://api.live.bilibili.com/room/v1/Room/room_init?id=${fakeRoomID}`)
      .timeout(5000)
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2987.133 Safari/537.36')
      .set('Referer', `${baseURL}`)

    let trueRoomID = result.body.data.room_id

    result = await request.get(`http://api.live.bilibili.com/room/v1/Room/get_info?room_id=${trueRoomID}&from=room`)
      .timeout(5000)
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2987.133 Safari/537.36')
      .set('Referer', `${baseURL}`)
    let roomTitle = result.body.data.title

    result = await request.get(`http://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${trueRoomID}`)
    let roomUP = result.body.data.info.uname

    logger.info(`房间信息 : 输入的房间地址为 ${fakeRoomID}, 已解析出房间真实地址为 ${trueRoomID}`)
    logger.info(`房间信息 : 房间标题为 ${roomTitle}, UP主为 ${roomUP}`)

    return trueRoomID
  }

  async getDammuServerAddress (roomID) {
    let result = await request.get(`${baseURL}/api/player?id=cid:${roomID}`)
      .timeout(5000)
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2987.133 Safari/537.36')
      .set('Referer', `${baseURL}`)

    let danmuServer = result.text.match(/livecmt.*?com/)[0]
    logger.info('成功解析弹幕服务器地址: ' + danmuServer)
    return danmuServer
  }

  async getLiveAddress (roomID) {
    let result = await request.get(`https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${roomID}&quality=0&platform=web`)
    .timeout(5000)
    .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2987.133 Safari/537.36')
    .set('Referer', `${baseURL}`)

    let url = result.body.data.durl[0].url
    return url
  }

  start () {
    this.client.connect(this.port, this.danmuServer, () => {
      logger.info(`连接到了${this.danmuServer}:${this.port}.`)

      // 每隔30秒发送一次心跳包
      // 心跳包格式固定, 不要修改
      this.heartBeatHandler = setInterval(() => {
        let heart = Buffer.from([0x00, 0x00, 0x00, 0x10, 0x00, 0x10, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01])
        this.client.write(heart)
        logger.info('已发送心跳包!')
      }, 30000)

      // 开启直播间所需要发送的数据包 其头部格式第4项是数据包的长度
      let head = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x01, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x01])
      let body = Buffer.from(JSON.stringify({ roomid: Number(this.roomID), uid: Math.ceil(100000000000000.0 + 200000000000000.0 * Math.random()) }))
      let buffer = Buffer.concat([head, body])
      buffer[3] = buffer.length

      // 第一次发送数据包
      this.client.write(buffer)
      logger.info('已发送开启弹幕收集器所需要的数据包')
    })
  }
}

module.exports = BilibiliClient
