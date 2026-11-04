package com.mybusiness.feature.banking.data.di

import com.mybusiness.core.network.api.BankingApiService
import com.mybusiness.feature.banking.data.repository.BankingRepositoryImpl
import com.mybusiness.feature.banking.domain.repository.BankingRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object BankingModule {

    @Provides
    @Singleton
    fun provideBankingRepository(api: BankingApiService): BankingRepository =
        BankingRepositoryImpl(api)
}
