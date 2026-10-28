package com.mybusiness.feature.auth.data.di

import com.mybusiness.core.datastore.UserSessionDataStore
import com.mybusiness.core.network.api.AuthApiService
import com.mybusiness.feature.auth.BuildConfig
import com.mybusiness.feature.auth.data.repository.AuthRepositoryImpl
import com.mybusiness.feature.auth.data.repository.FakeAuthRepository
import com.mybusiness.feature.auth.domain.repository.AuthRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AuthModule {

    @Provides
    @Singleton
    fun provideAuthRepository(
        authApiService: AuthApiService,
        sessionDataStore: UserSessionDataStore
    ): AuthRepository {
        return if (BuildConfig.USE_MOCK_AUTH) {
            FakeAuthRepository(sessionDataStore)
        } else {
            AuthRepositoryImpl(authApiService, sessionDataStore)
        }
    }
}
