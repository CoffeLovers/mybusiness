package com.mybusiness.feature.dashboard.data.di

import com.mybusiness.feature.dashboard.data.repository.FakeDashboardRepository
import com.mybusiness.feature.dashboard.domain.repository.DashboardRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DashboardModule {

    @Provides
    @Singleton
    fun provideDashboardRepository(): DashboardRepository {
        return FakeDashboardRepository()
    }
}
