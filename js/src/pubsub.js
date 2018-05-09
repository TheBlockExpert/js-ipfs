/* eslint-env mocha */
/* eslint max-nested-callbacks: ['error', 8] */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const series = require('async/series')
const each = require('async/each')
const waterfall = require('async/waterfall')
const parallel = require('async/parallel')
const whilst = require('async/whilst')
const hat = require('hat')

// On Browsers it will be false, but the tests currently aren't run
// there anyway
let isWindows = process.platform && process.platform === 'win32'

function waitForPeers (ipfs, topic, peersToWait, callback) {
  const i = setInterval(() => {
    ipfs.pubsub.peers(topic, (err, peers) => {
      if (err) {
        return callback(err)
      }

      const missingPeers = peersToWait
        .map((e) => peers.indexOf(e) !== -1)
        .filter((e) => !e)

      if (missingPeers.length === 0) {
        clearInterval(i)
        callback()
      }
    })
  }, 500)
}

function spawnWithId (factory, callback) {
  waterfall([
    (cb) => factory.spawnNode(cb),
    (node, cb) => node.id((err, res) => {
      if (err) {
        return cb(err)
      }
      node.peerId = res
      cb(null, node)
    })
  ], callback)
}

function makeCheck (n, done) {
  let i = 0
  return (err) => {
    if (err) {
      return done(err)
    }

    if (++i === n) {
      done()
    }
  }
}

module.exports = (common) => {
  describe('.pubsub', function () {
    this.timeout(80 * 1000)

    const getTopic = () => 'pubsub-tests-' + hat()

    let ipfs1
    let ipfs2
    let ipfs3
    let withGo

    before(function (done) {
      // CI takes longer to instantiate the daemon, so we need to increase the
      // timeout for the before step
      this.timeout(100 * 1000)

      common.setup((err, factory) => {
        if (err) {
          return done(err)
        }

        series([
          (cb) => spawnWithId(factory, cb),
          (cb) => spawnWithId(factory, cb),
          (cb) => spawnWithId(factory, cb)
        ], (err, nodes) => {
          if (err) {
            return done(err)
          }

          ipfs1 = nodes[0]
          ipfs2 = nodes[1]
          ipfs3 = nodes[2]

          ipfs1.id((err, id) => {
            expect(err).to.not.exist()
            withGo = id.agentVersion.startsWith('go-ipfs')
            done()
          })
        })
      })
    })

    after((done) => {
      common.teardown(done)
    })

    describe('single node', () => {
      describe('.publish', () => {
        it('errors on string messags', (done) => {
          const topic = getTopic()
          ipfs1.pubsub.publish(topic, 'hello friend', (err) => {
            expect(err).to.exist()
            done()
          })
        })

        it('message from buffer', (done) => {
          const topic = getTopic()
          ipfs1.pubsub.publish(topic, Buffer.from('hello friend'), done)
        })
      })

      describe('.subscribe', () => {
        it('to one topic', (done) => {
          const check = makeCheck(2, done)
          const topic = getTopic()

          const handler = (msg) => {
            expect(msg.data.toString()).to.equal('hi')
            expect(msg).to.have.property('seqno')
            expect(Buffer.isBuffer(msg.seqno)).to.eql(true)
            expect(msg).to.have.property('topicIDs').eql([topic])
            expect(msg).to.have.property('from', ipfs1.peerId.id)

            ipfs1.pubsub.unsubscribe(topic, handler, (err) => {
              expect(err).to.not.exist()

              ipfs1.pubsub.ls((err, topics) => {
                expect(err).to.not.exist()
                expect(topics).to.be.empty()
                check()
              })
            })
          }

          ipfs1.pubsub.subscribe(topic, handler, (err) => {
            expect(err).to.not.exist()
            ipfs1.pubsub.publish(topic, Buffer.from('hi'), check)
          })
        })

        it('to one topic with Promise', (done) => {
          const check = makeCheck(2, done)
          const topic = getTopic()

          const handler = (msg) => {
            expect(msg.data.toString()).to.equal('hi')
            expect(msg).to.have.property('seqno')
            expect(Buffer.isBuffer(msg.seqno)).to.eql(true)
            expect(msg).to.have.property('topicIDs').eql([topic])
            expect(msg).to.have.property('from', ipfs1.peerId.id)

            ipfs1.pubsub.unsubscribe(topic, handler, (err) => {
              expect(err).to.not.exist()

              ipfs1.pubsub.ls((err, topics) => {
                expect(err).to.not.exist()
                expect(topics).to.be.empty()
                check()
              })
            })
          }

          ipfs1.pubsub
            .subscribe(topic, handler)
            .then(() => ipfs1.pubsub.publish(topic, Buffer.from('hi'), check))
            .catch((err) => expect(err).to.not.exist())
        })

        it('to one topic with options and Promise', (done) => {
          const check = makeCheck(2, done)
          const topic = getTopic()

          const handler = (msg) => {
            expect(msg.data.toString()).to.equal('hi')
            expect(msg).to.have.property('seqno')
            expect(Buffer.isBuffer(msg.seqno)).to.eql(true)
            expect(msg).to.have.property('topicIDs').eql([topic])
            expect(msg).to.have.property('from', ipfs1.peerId.id)

            ipfs1.pubsub.unsubscribe(topic, handler, (err) => {
              expect(err).to.not.exist()

              ipfs1.pubsub.ls((err, topics) => {
                expect(err).to.not.exist()
                expect(topics).to.be.empty()
                check()
              })
            })
          }

          ipfs1.pubsub
            .subscribe(topic, {}, handler)
            .then(() => ipfs1.pubsub.publish(topic, Buffer.from('hi'), check))
            .catch((err) => expect(err).to.not.exist())
        })

        it('attaches multiple event listeners', (done) => {
          const topic = getTopic()

          const check = makeCheck(3, done)
          const handler1 = (msg) => {
            expect(msg.data.toString()).to.eql('hello')

            series([
              (cb) => ipfs1.pubsub.unsubscribe(topic, handler1, cb)
              (cb) => ipfs1.pubsub.ls(cb),
              (cb) => ipfs1.pubsub.unsubscribe(topic, handler2, cb),
              (cb) => ipfs1.pubsub.ls(cb)
            ], (err, res) => {
              expect(err).to.not.exist()

              // Still subscribed as there is one listener left
              expect(res[0]).to.eql([topic])
              // Now all listeners are gone no subscription anymore
              expect(res[2]).to.eql([])
              check()
            })
          }

          const handler2 = (msg) => {
            expect(msg.data.toString()).to.eql('hello')
            check()
          }

          parallel([
            (cb) => ipfs1.pubsub.subscribe(topic, handler1, cb),
            (cb) => ipfs1.pubsub.subscribe(topic, handler2, cb)
          ], (err) => {
            expect(err).to.not.exist()
            ipfs1.pubsub.publish(topic, Buffer.from('hello'), check)
          })
        })

        it('discover options', (done) => {
          const check = makeCheck(2, done)
          const topic = getTopic()

          const handler = (msg) => {
            expect(msg.data.toString()).to.eql('hi')
            ipfs1.pubsub.unsubscribe(topic, handler, check)
          }

          ipfs1.pubsub.subscribe(topic, handler, { discover: true }, (err) => {
            expect(err).to.not.exist()
            ipfs1.pubsub.publish(topic, Buffer.from('hi'), check)
          })
        })
      })
    })

    describe('multiple nodes connected', () => {
      before((done) => {
        parallel([
          (cb) => ipfs1.swarm.connect(ipfs2.peerId.addresses.find((a) => a.includes('127.0.0.1')), cb),
          (cb) => ipfs2.swarm.connect(ipfs3.peerId.addresses.find((a) => a.includes('127.0.0.1')), cb),
          (cb) => ipfs1.swarm.connect(ipfs3.peerId.addresses.find((a) => a.includes('127.0.0.1')), cb)
        ], (err) => {
          if (err) {
            return done(err)
          }
          // give some time to let everything connect
          setTimeout(done, 300)
        })
      })

      describe('.peers', () => {
        it('does not error when not subscribed to a topic', (done) => {
          const topic = getTopic()
          ipfs1.pubsub.peers(topic, (err, peers) => {
            expect(err).to.not.exist()
            // Should be empty() but as mentioned below go-ipfs returns more than it should
            // expect(peers).to.be.empty()

            done()
          })
        })

        it("doesn't return extra peers", (done) => {
          // Currently go-ipfs returns peers that have not been
          // subscribed to the topic. Enable when go-ipfs has been fixed
          const sub1 = (msg) => {}
          const sub2 = (msg) => {}
          const sub3 = (msg) => {}

          const topic = getTopic()
          const topicOther = topic + 'different topic'

          series([
            (cb) => ipfs1.pubsub.subscribe(topic, sub1, cb),
            (cb) => ipfs2.pubsub.subscribe(topicOther, sub2, cb),
            (cb) => ipfs3.pubsub.subscribe(topicOther, sub3, cb)
          ], (err) => {
            expect(err).to.not.exist()

            ipfs1.pubsub.peers(topic, (err, peers) => {
              expect(err).to.not.exist()

              expect(peers).to.be.empty()
              ipfs1.pubsub.unsubscribe(topic, sub1)
              ipfs2.pubsub.unsubscribe(topicOther, sub2)
              ipfs3.pubsub.unsubscribe(topicOther, sub3)
              done()
            })
          })
        })

        it('returns peers for a topic - one peer', (done) => {
          // Currently go-ipfs returns peers that have not been
          // subscribed to the topic. Enable when go-ipfs has been fixed
          const sub1 = (msg) => {}
          const sub2 = (msg) => {}
          const sub3 = (msg) => {}
          const topic = getTopic()

          series([
            (cb) => ipfs1.pubsub.subscribe(topic, sub1, cb),
            (cb) => ipfs2.pubsub.subscribe(topic, sub2, cb),
            (cb) => ipfs3.pubsub.subscribe(topic, sub3, cb),
            (cb) => waitForPeers(ipfs1, topic, [ipfs2.peerId.id], cb)
          ], (err) => {
            expect(err).to.not.exist()
            ipfs1.pubsub.unsubscribe(topic, sub1)
            ipfs2.pubsub.unsubscribe(topic, sub2)
            ipfs3.pubsub.unsubscribe(topic, sub3)

            done()
          })
        })

        it('lists peers for a topic - multiple peers', (done) => {
          const sub1 = (msg) => {}
          const sub2 = (msg) => {}
          const sub3 = (msg) => {}
          const topic = getTopic()

          series([
            (cb) => ipfs1.pubsub.subscribe(topic, sub1, cb),
            (cb) => ipfs2.pubsub.subscribe(topic, sub2, cb),
            (cb) => ipfs3.pubsub.subscribe(topic, sub3, cb),
            (cb) => waitForPeers(ipfs1, topic, [
              ipfs2.peerId.id,
              ipfs3.peerId.id
            ], cb)
          ], (err) => {
            expect(err).to.not.exist()
            ipfs1.pubsub.unsubscribe(topic, sub1)
            ipfs2.pubsub.unsubscribe(topic, sub2)
            ipfs3.pubsub.unsubscribe(topic, sub3)

            done()
          })
        })
      })

      describe('.ls', () => {
        it('empty() list when no topics are subscribed', (done) => {
          ipfs1.pubsub.ls((err, topics) => {
            expect(err).to.not.exist()
            expect(topics.length).to.equal(0)
            done()
          })
        })

        it('list with 1 subscribed topic', (done) => {
          const sub1 = (msg) => {}
          const topic = getTopic()

          ipfs1.pubsub.subscribe(topic, sub1, (err) => {
            expect(err).to.not.exist()

            ipfs1.pubsub.ls((err, topics) => {
              expect(err).to.not.exist()
              expect(topics).to.be.eql([topic])

              ipfs1.pubsub.unsubscribe(topic, sub1, done)
            })
          })
        })

        it('list with 3 subscribed topics', (done) => {
          const topics = [{
            name: 'one',
            handler () {}
          }, {
            name: 'two',
            handler () {}
          }, {
            name: 'three',
            handler () {}
          }]

          each(topics, (t, cb) => {
            ipfs1.pubsub.subscribe(t.name, t.handler, cb)
          }, (err) => {
            expect(err).to.not.exist()
            ipfs1.pubsub.ls((err, list) => {
              expect(err).to.not.exist()

              expect(list.sort())
                .to.eql(topics.map((t) => t.name).sort())

              topics.forEach((t) => {
                ipfs1.pubsub.unsubscribe(t.name, t.handler)
              })

              done()
            })
          })
        })
      })

      describe('multiple nodes', () => {
        let topic
        let sub1
        let sub2

        beforeEach(() => {
          topic = getTopic()
        })

        afterEach((done) => {
          parallel([
           (cb) => ipfs1.pubsub.unsubscribe(topic, sub1, cb)
           (cb) => ipfs2.pubsub.unsubscribe(topic, sub2, cb)
          ], done)
        })

        it('receive messages from different node', (done) => {
          const check = makeCheck(3, done)
          const expectedString = 'hello from the other side'

          sub1 = (msg) => {
            expect(msg.data.toString()).to.be.eql(expectedString)
            expect(msg.from).to.eql(ipfs2.peerId.id)
            check()
          }

          sub2 = (msg) => {
            expect(msg.data.toString()).to.be.eql(expectedString)
            expect(msg.from).to.eql(ipfs2.peerId.id)
            check()
          }

          series([
            (cb) => ipfs1.pubsub.subscribe(topic, sub1, cb),
            (cb) => ipfs2.pubsub.subscribe(topic, sub2, cb),
            (cb) => waitForPeers(ipfs2, topic, [ipfs1.peerId.id], cb)
          ], (err) => {
            expect(err).to.not.exist()

            ipfs2.pubsub.publish(topic, Buffer.from(expectedString), check)
          })
        })

        it('round trips a non-utf8 binary buffer correctly', (done) => {
          const check = makeCheck(3, done)
          const expectedHex = 'a36161636179656162830103056164a16466666666f4'
          const buffer = Buffer.from(expectedHex, 'hex')

          sub1 = (msg) => {
            try {
              expect(msg.data.toString('hex')).to.be.eql(expectedHex)
              expect(msg.from).to.eql(ipfs2.peerId.id)
              check()
            } catch (err) {
              check(err)
            }
          }

          sub2 = (msg) => {
            try {
              expect(msg.data.toString('hex')).to.eql(expectedHex)
              expect(msg.from).to.eql(ipfs2.peerId.id)
              check()
            } catch (err) {
              check(err)
            }
          }

          series([
            (cb) => ipfs1.pubsub.subscribe(topic, sub1, cb),
            (cb) => ipfs2.pubsub.subscribe(topic, sub2, cb),
            (cb) => waitForPeers(ipfs2, topic, [ipfs1.peerId.id], cb)
          ], (err) => {
            expect(err).to.not.exist()

            ipfs2.pubsub.publish(topic, buffer, check)
          })
        })

        it('receive multiple messages', function (done) {
          // TODO fix https://github.com/ipfs/interface-ipfs-core/pull/188#issuecomment-354673246
          // and https://github.com/ipfs/go-ipfs/issues/4778
          if (withGo && isWindows) {
            this.skip()
          }

          const inbox1 = []
          const inbox2 = []
          const outbox = ['hello', 'world', 'this', 'is', 'pubsub']

          const check = makeCheck(outbox.length * 3, (err) => {
            expect(inbox1.sort()).to.eql(outbox.sort())
            expect(inbox2.sort()).to.eql(outbox.sort())

            done(err)
          })

          sub1 = (msg) => {
            inbox1.push(msg.data.toString())
            expect(msg.from).to.eql(ipfs2.peerId.id)
            check()
          }

          sub2 = (msg) => {
            inbox2.push(msg.data.toString())
            expect(msg.from).to.be.eql(ipfs2.peerId.id)
            check()
          }

          series([
            (cb) => ipfs1.pubsub.subscribe(topic, sub1, cb),
            (cb) => ipfs2.pubsub.subscribe(topic, sub2, cb),
            (cb) => waitForPeers(ipfs2, topic, [ipfs1.peerId.id], cb)
          ], (err) => {
            expect(err).to.not.exist()

            outbox.forEach((msg) => {
              ipfs2.pubsub.publish(topic, Buffer.from(msg), check)
            })
          })
        })
      })

      describe('load tests', function () {
        before(() => {
          ipfs1.pubsub.setMaxListeners(10 * 1000)
          ipfs2.pubsub.setMaxListeners(10 * 1000)
        })

        after(() => {
          ipfs1.pubsub.setMaxListeners(10)
          ipfs2.pubsub.setMaxListeners(10)
        })

        it('call publish 1k times', (done) => {
          const count = 1000
          let sendCount = 0
          const topic = getTopic()

          whilst(
            () => sendCount < count,
            (cb) => {
              sendCount++
              ipfs1.pubsub.publish(topic, Buffer.from('hey there'), cb)
            },
            done
          )
        })

        describe('send/receive', () => {
          let topic
          let sub1
          let sub2

          beforeEach(function () {
            // TODO fix https://github.com/ipfs/interface-ipfs-core/pull/188#issuecomment-354673246
            // and https://github.com/ipfs/go-ipfs/issues/4778
            if (withGo && isWindows) {
              this.skip()
            }

            topic = getTopic()
          })

          afterEach(() => {
            ipfs1.pubsub.unsubscribe(topic, sub1)
            ipfs2.pubsub.unsubscribe(topic, sub2)
          })

          it('send/receive 10k messages', function (done) {
            this.timeout(2 * 60 * 1000)

            const msgBase = 'msg - '
            const count = 10000
            let sendCount = 0
            let receivedCount = 0
            let startTime
            let counter = 0

            sub1 = (msg) => {
              // go-ipfs can't send messages in order when there are
              // only two nodes in the same machine ¯\_(ツ)_/¯
              // https://github.com/ipfs/js-ipfs-api/pull/493#issuecomment-289499943
              // const expectedMsg = msgBase + receivedCount
              // const receivedMsg = msg.data.toString()
              // expect(receivedMsg).to.eql(expectedMsg)

              receivedCount++

              if (receivedCount >= count) {
                const duration = new Date().getTime() - startTime
                const opsPerSec = Math.floor(count / (duration / 1000))

                console.log(`Send/Receive 10k messages took: ${duration} ms, ${opsPerSec} ops / s\n`)

                check()
              }
            }

            sub2 = (msg) => {}

            function check () {
              if (++counter === 2) {
                done()
              }
            }

            series([
              (cb) => ipfs1.pubsub.subscribe(topic, sub1, cb),
              (cb) => ipfs2.pubsub.subscribe(topic, sub2, cb),
              (cb) => waitForPeers(ipfs1, topic, [ipfs2.peerId.id], cb)
            ], (err) => {
              expect(err).to.not.exist()
              startTime = new Date().getTime()

              whilst(
                () => sendCount < count,
                (cb) => {
                  const msgData = Buffer.from(msgBase + sendCount)
                  sendCount++
                  ipfs2.pubsub.publish(topic, msgData, cb)
                },
                check
              )
            })
          })
        })

        it('call subscribe/unsubscribe 1k times', (done) => {
          const count = 1000
          let sendCount = 0
          const handlers = []

          const someTopic = getTopic()

          whilst(
            () => sendCount < count,
            (cb) => {
              sendCount++
              const handler = (msg) => {}
              handlers.push(handler)
              ipfs1.pubsub.subscribe(someTopic, handler, cb)
            },
            (err) => {
              expect(err).to.not.exist()
              each(
                handlers,
                (handler, cb) => ipfs1.pubsub.unsubscribe(someTopic, handler, cb)
                (err) => {
                  expect(err).to.not.exist()
                  ipfs1.pubsub.ls((err, topics) => {
                    expect(err).to.not.exist()
                    expect(topics).to.eql([])
                    done()
                  })
                })
              })
            }
          )
        })
      })
    })
  })
}
