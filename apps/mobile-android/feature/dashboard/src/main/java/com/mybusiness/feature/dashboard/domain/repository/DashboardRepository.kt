package com.mybusiness.feature.dashboard.domain.repository

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.DashboardSummary

interface DashboardRepository {
    suspend fun getDashboardSummary(): Result<DashboardSummary>
}
