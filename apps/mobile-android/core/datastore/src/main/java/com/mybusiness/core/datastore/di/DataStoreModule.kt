package com.mybusiness.core.datastore.di

import android.content.Context
import com.mybusiness.core.datastore.UserSessionDataStore
import com.mybusiness.core.datastore.UserSessionDataStoreImpl
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DataStoreModule {

    @Provides
    @Singleton
    fun provideUserSessionDataStore(
        @ApplicationContext context: Context
    ): UserSessionDataStore {
        return UserSessionDataStoreImpl(context)
    }
}
