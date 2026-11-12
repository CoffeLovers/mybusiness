package com.mybusiness.voice

import android.content.Intent
import android.speech.RecognitionService

class MyBusinessRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
        // RecognitionService local no almacena ni envía audio a terceros
    }

    override fun onCancel(listener: Callback?) {
    }

    override fun onStopListening(listener: Callback?) {
    }
}
