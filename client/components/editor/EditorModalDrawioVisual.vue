<template lang='pug'>
  v-card.editor-modal-drawio-visual.animated.fadeIn(v-if='isOpen', flat, tile)
    iframe(
      ref='drawio'
      src='https://embed.diagrams.net/?embed=1&proto=json&spin=1&saveAndExit=1&noSaveBtn=1&noExitBtn=0'
      frameborder='0'
    )
</template>

<script>
export default {
  data() {
    return {
      isOpen: false,
      currentXml: null,
      isInitialized: false
    }
  },
  methods: {
    openDrawio (xml = null) {
      this.currentXml = xml
      this.isOpen = true
      this.isInitialized = false
    },
    close () {
      this.isOpen = false
      this.currentXml = null
      this.isInitialized = false
    },
    send (msg) {
      if (this.$refs.drawio && this.$refs.drawio.contentWindow) {
        this.$refs.drawio.contentWindow.postMessage(JSON.stringify(msg), '*')
      }
    },
    receive (evt) {
      if (!this.isOpen || evt.source !== this.$refs.drawio?.contentWindow || evt.data.length < 1) {
        return
      }
      try {
        const msg = JSON.parse(evt.data)
        switch (msg.event) {
          case 'init': {
            // Send existing diagram XML if editing
            this.send({
              action: 'load',
              autosave: 0,
              modified: 'unsavedChanges',
              xml: this.currentXml || '',
              title: 'Diagram'
            })
            this.isInitialized = true
            break
          }
          case 'save': {
            if (msg.exit) {
              // Request SVG export
              this.send({
                action: 'export',
                format: 'xmlsvg'
              })
            }
            break
          }
          case 'export': {
            // Extract SVG data from the response
            const svgDataStart = msg.data.indexOf('base64,') + 7
            const svgBase64 = msg.data.slice(svgDataStart)

            // Emit event with diagram data
            this.$emit('diagram-ready', {
              xml: msg.xml,
              svg: svgBase64
            })

            this.close()
            break
          }
          case 'exit': {
            this.close()
            break
          }
        }
      } catch (err) {
        console.error('[DrawioVisual] Error processing message:', err)
      }
    },
    handleOpenDrawio (evt) {
      this.openDrawio(evt.detail)
    }
  },
  mounted () {
    window.addEventListener('message', this.receive)
    window.addEventListener('editor:openDrawio', this.handleOpenDrawio)
  },
  beforeDestroy () {
    window.removeEventListener('message', this.receive)
    window.removeEventListener('editor:openDrawio', this.handleOpenDrawio)
  }
}
</script>

<style lang='scss'>
.editor-modal-drawio-visual {
  position: fixed !important;
  top: 0;
  left: 0;
  z-index: 1000;
  width: 100%;
  height: 100vh;
  background-color: rgba(255,255,255, 1) !important;
  overflow: hidden;

  > iframe {
    width: 100%;
    height: 100vh;
    border: 0;
    padding: 0;
    background-color: #FFF;
  }
}
</style>
