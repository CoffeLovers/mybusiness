package com.mybusiness.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import com.mybusiness.MainActivity

class MyBusinessVoiceSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        return MyBusinessVoiceSession(this)
    }
}

class MyBusinessVoiceSession(context: Context) : VoiceInteractionSession(context) {
    @Suppress("DEPRECATION")
    override fun onHandleAssist(data: Bundle?, structure: android.app.assist.AssistStructure?, content: android.app.assist.AssistContent?) {
        super.onHandleAssist(data, structure, content)
        // Iniciar MainActivity en la pantalla de chat si se invoca como asistente de voz
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        startVoiceActivity(intent)
    }
}
