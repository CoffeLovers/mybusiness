package com.mybusiness.feature.dashboard.domain.usecase

import com.mybusiness.core.common.result.Result
import com.mybusiness.core.model.DashboardSummary
import com.mybusiness.feature.dashboard.domain.repository.DashboardRepository
import javax.inject.Inject

class GetDashboardSummaryUseCase @Inject constructor(
    private val dashboardRepository: DashboardRepository
) {
    suspend operator fun invoke(): Result<DashboardSummary> {
        return dashboardRepository.getDashboardSummary()
    }
}
