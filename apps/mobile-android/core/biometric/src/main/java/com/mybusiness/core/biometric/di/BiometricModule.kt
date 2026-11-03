package com.mybusiness.core.biometric.di

import android.content.Context
import com.mybusiness.core.biometric.AndroidBiometricGate
import com.mybusiness.core.biometric.BiometricGate
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object BiometricModule {
    @Provides
    @Singleton
    fun provideBiometricGate(@ApplicationContext context: Context): BiometricGate =
        AndroidBiometricGate(context)
}
