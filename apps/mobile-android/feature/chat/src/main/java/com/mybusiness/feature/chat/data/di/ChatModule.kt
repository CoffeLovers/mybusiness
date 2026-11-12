package com.mybusiness.feature.chat.data.di

import com.mybusiness.feature.chat.data.repository.ChatRepositoryImpl
import com.mybusiness.feature.chat.data.voice.VoiceManagerImpl
import com.mybusiness.feature.chat.domain.repository.ChatRepository
import com.mybusiness.feature.chat.domain.voice.VoiceManager
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class ChatModule {

    @Binds
    @Singleton
    abstract fun bindChatRepository(impl: ChatRepositoryImpl): ChatRepository

    @Binds
    @Singleton
    abstract fun bindVoiceManager(impl: VoiceManagerImpl): VoiceManager
}
